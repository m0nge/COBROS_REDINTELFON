import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../server/routes/escalados.ts';

function recorder() {
  return {
    statusCode: 200,
    body: null as Record<string, any> | null,
    setHeader() {},
    status(code: number) { this.statusCode = code; return this; },
    json(body: Record<string, any>) { this.body = body; return this; },
  };
}

function withFetch(role: 'agente' | 'admin', options: { attempts: number; openEscalation: boolean; daysArrears?: number }) {
  const writes: Array<{ path: string; body: any }> = [];
  const original = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== 'GET') writes.push({ path: url.pathname, body });
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'auth-1' });
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      const ownerLookup = url.searchParams.get('id') === 'eq.owner-1';
      return Response.json([{
        id: ownerLookup ? 'owner-1' : 'user-1',
        auth_id: ownerLookup ? 'auth-owner' : 'auth-1',
        nombre: ownerLookup ? 'Gestor dueño' : 'Usuario',
        email: 'u@example.invalid',
        pais: 'SV',
        rol: ownerLookup ? 'agente' : role,
        estado: 'activo',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) return Response.json([{ codigo_cliente: 'CL001' }]);
    if (url.pathname.endsWith('/rest/v1/clientes')) return Response.json([{ id: 'client-1', codigo: 'CL001', total_deuda: 80, dias_mora: options.daysArrears ?? 40 }]);
    if (url.pathname.endsWith('/rest/v1/escalaciones_criticas')) {
      if (method !== 'GET') return Response.json([{ id: 'esc-1' }]);
      return Response.json(options.openEscalation ? [{ id: 'esc-1', estado: 'Escalado' }] : []);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      if (method !== 'GET') return Response.json([{ id: 'g-1' }]);
      return Response.json(Array.from({ length: options.attempts }, (_, index) => ({ id: `a${index}` })));
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { writes, restore: () => { globalThis.fetch = original; } };
}

const request = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: { authorization: 'Bearer unit-test' },
  body: { pais: 'SV', codigo_cliente: 'CL001', ...body },
});

test('an agent can escalate only after two management attempts', async () => {
  let env = withFetch('agente', { attempts: 1, openEscalation: false });
  let res = recorder();
  try {
    await handler(request({ operacion: 'escalar' }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.error, 'NOT_ENOUGH_ATTEMPTS');
    assert.equal(env.writes.length, 0);
  } finally { env.restore(); }

  env = withFetch('agente', { attempts: 2, openEscalation: false });
  res = recorder();
  try {
    await handler(request({ operacion: 'escalar', motivo: 'No paga' }), res);
    assert.equal(res.statusCode, 200);
    const insert = env.writes.find((write) => write.path.endsWith('/escalaciones_criticas'));
    assert.equal(insert?.body.agente_id, 'user-1');
    assert.equal(insert?.body.motivo, 'No paga');
  } finally { env.restore(); }
});

test('admin can manage only escalated clients and a promise stays pending', async () => {
  let env = withFetch('admin', { attempts: 0, openEscalation: false });
  let res = recorder();
  try {
    await handler(request({ operacion: 'gestionar', canal: 'Llamada', contacto_exitoso: 'Si', acuerdo: 'Sin Acuerdo' }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error, 'CLIENT_NOT_ESCALATED');
  } finally { env.restore(); }

  env = withFetch('admin', { attempts: 0, openEscalation: true });
  res = recorder();
  try {
    await handler(request({
      operacion: 'gestionar', canal: 'Llamada', contacto_exitoso: 'Si', acuerdo: 'Promesa de Pago',
      fecha_promesa: '2099-01-10', monto_comprometido: 50,
    }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const management = env.writes.find((write) => write.path.endsWith('/bitacora_gestiones'));
    assert.equal(management?.body.fecha_limite_pago, '2099-01-10');
    assert.equal(management?.body.valores_dinamicos.source, 'escalado');
    const update = env.writes.find((write) => write.path.endsWith('/escalaciones_criticas'));
    assert.equal(update?.body.estado, 'Promesa pendiente');
  } finally { env.restore(); }
});


test('admin imports critical clients once under their assigned manager', async () => {
  const env = withFetch('admin', { attempts: 0, openEscalation: false, daysArrears: 165 });
  const res = recorder();
  try {
    await handler(request({
      operacion: 'importar-criticos',
      clientes: [{ codigo_cliente: 'CL001', agente_id: 'owner-1' }],
    }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body?.imported, ['CL001']);
    const insert = env.writes.find((write) => write.path.endsWith('/escalaciones_criticas'));
    assert.equal(insert?.body.agente_id, 'owner-1');
    assert.equal(insert?.body.dias_mora, 165);
    assert.match(insert?.body.motivo, /Importación inicial/);
  } finally { env.restore(); }
});
