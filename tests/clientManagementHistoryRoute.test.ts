import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../server/routes/clientManagementHistory.ts';

function responseMock() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('returns all client history only after checking the agent’s country and assignment', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/auth/v1/user')) return jsonResponse({ id: 'auth-agent' });
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return jsonResponse([{
        id: 'agent-1', auth_id: 'auth-agent', nombre: 'Agente Uno', email: 'agente@example.com',
        telefono: '', pais: 'SV', rol: 'agente', estado: 'activo', avatar_url: '',
        extension_pbx: '6031', tasa_efectividad: 0,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return jsonResponse([{ codigo_cliente: 'CL003263' }]);
    }
    if (url.pathname.endsWith('/rest/v1/clientes')) {
      return jsonResponse([{ id: 'client-1', codigo: 'CL003263', nombre: 'Cliente Uno' }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      return jsonResponse([
        {
          id: 'management-2', agente_id: 'agent-1', tipo_gestion: 'Llamada', contacto_exitoso: 'Si',
          acuerdo: 'Promesa de Pago', duracion_llamada_segundos: 92, fecha_limite_pago: '2026-11-08',
          monto_comprometido: 250, observaciones: 'Prometió pagar', validacion_exitosa: true,
          created_at: '2026-11-05T15:30:00.000Z',
          valores_dinamicos: { pbxCall: { callId: 'call-2', durationSeconds: 92 } },
          agentes: { nombre: 'Agente Uno', email: 'agente@example.com', extension_pbx: '6031' },
        },
        {
          id: 'management-1', agente_id: 'agent-1', tipo_gestion: 'WhatsApp', contacto_exitoso: 'Si',
          acuerdo: 'Sin acuerdo', duracion_llamada_segundos: null, fecha_limite_pago: null,
          monto_comprometido: null, observaciones: 'Seguimiento anterior', validacion_exitosa: true,
          created_at: '2026-10-03T15:30:00.000Z', valores_dinamicos: {},
          agentes: { nombre: 'Agente Uno', email: 'agente@example.com', extension_pbx: '6031' },
        },
      ]);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const res = responseMock();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer test-session' },
      query: { pais: 'SV', codigo_cliente: 'cl003263' },
    }, res);

    const payload = res.payload as { success: boolean; records: Array<Record<string, unknown>> };
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(payload.success, true);
    assert.deepEqual(payload.records.map((record) => record.id), ['management-2', 'management-1']);
    assert.equal(payload.records[0].pbxExtension, '6031');
    assert.equal(payload.records[0].durationSeconds, 92);
    assert.ok(requests.some((request) => request.includes('/rest/v1/asignaciones_cartera_fija')));
    assert.ok(requests.some((request) => request.includes('/rest/v1/bitacora_gestiones')));
    assert.ok(requests.some((request) => request.includes('agentes.pais=eq.SV')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test('denies an agent a history request for a client outside their portfolio', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname.endsWith('/auth/v1/user')) return jsonResponse({ id: 'auth-agent' });
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return jsonResponse([{
        id: 'agent-1', auth_id: 'auth-agent', nombre: 'Agente Uno', email: 'agente@example.com',
        telefono: '', pais: 'SV', rol: 'agente', estado: 'activo', avatar_url: '',
        extension_pbx: '6031', tasa_efectividad: 0,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) return jsonResponse([]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const res = responseMock();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer test-session' },
      query: { pais: 'SV', codigo_cliente: 'CL999999' },
    }, res);

    const payload = res.payload as { success: boolean; error: string };
    assert.equal(res.statusCode, 403);
    assert.equal(payload.success, false);
    assert.equal(payload.error, 'CLIENT_ACCESS_DENIED');
    assert.equal(requests.some((path) => path.endsWith('/rest/v1/bitacora_gestiones')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
