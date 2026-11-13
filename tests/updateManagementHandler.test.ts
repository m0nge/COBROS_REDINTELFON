import assert from 'node:assert/strict';
import test from 'node:test';
import updateManagementHandler from '../server/routes/updateManagement.ts';

const RECORD_ID = '2b92df89-5bba-4dab-9af5-8bb2b613ef2c';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null as Record<string, any> | null,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: Record<string, any>) {
      this.body = body;
      return this;
    },
  };
}

function makeRequestFetch(recordOwnerId = 'agent-1') {
  const requests: Array<{ method: string; path: string; body?: Record<string, any> }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      method,
      path: url.pathname.replace('/rest/v1/', ''),
      body: requestBody,
    });

    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'auth-user-1', email: 'agent@example.invalid' });
    }
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{
        id: 'agent-1',
        auth_id: 'auth-user-1',
        nombre: 'Agent Example',
        email: 'agent@example.invalid',
        telefono: null,
        pais: 'SV',
        rol: 'agente',
        estado: 'activo',
        avatar_url: null,
        extension_pbx: '6031',
        tasa_efectividad: null,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      return Response.json([{
        id: RECORD_ID,
        agente_id: recordOwnerId,
        cliente_id: 'client-1',
        acuerdo: 'Promesa de Pago',
        valores_dinamicos: {
          localAuditId: 'audit-original',
          scheduledForDate: '2026-11-05',
          periodMonth: '2026-11',
        },
        clientes: { codigo: 'CL001', pais: 'SV' },
        agentes: { email: 'agent@example.invalid', extension_pbx: '6031' },
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/rpc/update_management_record')) {
      return Response.json(RECORD_ID);
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { fakeFetch, requests };
}

test('updates the authorized existing management row through one atomic database RPC', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { fakeFetch, requests } = makeRequestFetch();
  globalThis.fetch = fakeFetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  const response = responseRecorder();

  try {
    await updateManagementHandler({
      method: 'POST',
      headers: { authorization: 'Bearer unit-test-access-token' },
      body: {
        id: RECORD_ID,
        pais: 'SV',
        codigo_cliente: 'CL001',
        tipo_gestion: 'WhatsApp',
        contacto_exitoso: 'Sí',
        acuerdo: 'Promesa de Pago',
        fecha_limite_pago: '2026-11-13',
        monto_comprometido: 125,
        observaciones: 'El cliente confirmó la fecha.',
        duracion_llamada_segundos: null,
        valores_dinamicos: {
          localAuditId: 'client-supplied-id-must-not-replace-original',
          scheduledForDate: '2026-11-13',
          periodMonth: '2026-11',
          contactChannel: 'WhatsApp',
        },
        validacion_exitosa: true,
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true, id: RECORD_ID });
    const rpc = requests.find((request) => request.path === 'rpc/update_management_record');
    assert.ok(rpc);
    assert.equal(rpc.method, 'POST');
    assert.equal(rpc.body?.p_record_id, RECORD_ID);
    assert.equal(rpc.body?.p_actor_id, 'agent-1');
    assert.equal(rpc.body?.p_tipo_gestion, 'WhatsApp');
    assert.equal(rpc.body?.p_acuerdo, 'Promesa de Pago');
    assert.equal(rpc.body?.p_fecha_limite_pago, '2026-11-13');
    assert.equal(rpc.body?.p_valores_dinamicos.scheduledForDate, '2026-11-13');
    assert.equal(rpc.body?.p_valores_dinamicos.localAuditId, 'audit-original');
    assert.equal(requests.filter((request) => request.method === 'PATCH').length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test('rejects editing a management owned by another agent', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { fakeFetch, requests } = makeRequestFetch('agent-2');
  globalThis.fetch = fakeFetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  const response = responseRecorder();

  try {
    await updateManagementHandler({
      method: 'POST',
      headers: { authorization: 'Bearer unit-test-access-token' },
      body: {
        id: RECORD_ID,
        pais: 'SV',
        codigo_cliente: 'CL001',
        tipo_gestion: 'WhatsApp',
        contacto_exitoso: 'Sí',
        acuerdo: 'Promesa de Pago',
        fecha_limite_pago: '2026-11-10',
        monto_comprometido: 125,
        observaciones: 'Cambio no autorizado.',
        valores_dinamicos: { scheduledForDate: '2026-11-05', periodMonth: '2026-11' },
      },
    }, response);

    assert.equal(response.statusCode, 403, JSON.stringify(response.body));
    assert.equal(response.body?.error, 'MANAGEMENT_EDIT_FORBIDDEN');
    assert.equal(requests.some((request) => request.path === 'rpc/update_management_record'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});
