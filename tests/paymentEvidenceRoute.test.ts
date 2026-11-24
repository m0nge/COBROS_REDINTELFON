import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../server/routes/paymentEvidence.ts';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null as Record<string, any> | null,
    setHeader() {},
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

function installFetchMock(recordAgentId: string, includeAssignment = true) {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const requests: URL[] = [];
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'auth-agent' });
    }
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{
        id: 'agent-1',
        auth_id: 'auth-agent',
        nombre: 'Agent Example',
        email: 'agent@example.invalid',
        pais: 'SV',
        rol: 'agente',
        estado: 'activo',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      return Response.json([{
        id: '3c3c3c3c-1111-4111-8111-111111111111',
        agente_id: recordAgentId,
        valores_dinamicos: {
          paymentEvidencePath: 'SV/CL001/agent-2/receipt.pdf',
        },
        clientes: { codigo: 'CL001', pais: 'SV' },
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return Response.json(includeAssignment ? [{ codigo_cliente: 'CL001' }] : []);
    }
    if (url.pathname.endsWith('/storage/v1/object/sign/comprobantes-pago/SV/CL001/agent-2/receipt.pdf')) {
      assert.equal(init?.method, 'POST');
      return Response.json({
        signedURL: '/object/sign/comprobantes-pago/SV/CL001/agent-2/receipt.pdf?token=unit-test',
      });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  };
}

test('an assigned agent can receive a short-lived download link for a client receipt', async () => {
  const restore = installFetchMock('agent-2');
  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer unit-test-agent-token' },
      query: {
        gestion_id: '3c3c3c3c-1111-4111-8111-111111111111',
        download: 'true',
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.success, true);
    assert.match(response.body?.signedUrl || '', /download=receipt\.pdf/);
  } finally {
    restore();
  }
});

test('an agent cannot access a receipt for a client outside their assigned portfolio', async () => {
  const restore = installFetchMock('agent-2', false);
  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer unit-test-agent-token' },
      query: { gestion_id: '3c3c3c3c-1111-4111-8111-111111111111' },
    }, response);

    assert.equal(response.statusCode, 403);
    assert.equal(response.body?.error, 'CLIENT_ACCESS_DENIED');
  } finally {
    restore();
  }
});
