import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../server/routes/noContactados.ts';

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

test('returns successful contact and paid codes only for the authenticated agent portfolio', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const requests: URL[] = [];
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'auth-agent' });
    }
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{
        id: 'agent-1',
        auth_id: 'auth-agent',
        pais: 'GT',
        rol: 'agente',
        estado: 'activo',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return Response.json([{ codigo_cliente: 'CONTACTADO' }, { codigo_cliente: 'PAGADO' }]);
    }
    if (url.pathname.endsWith('/rest/v1/clientes')) {
      assert.match(url.searchParams.get('codigo') || '', /CONTACTADO/);
      return Response.json([
        { id: 'client-contacted', codigo: 'CONTACTADO' },
        { id: 'client-paid', codigo: 'PAGADO' },
      ]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      assert.match(url.searchParams.get('cliente_id') || '', /client-contacted/);
      assert.match(url.searchParams.get('contacto_exitoso') || '', /Si/);
      return Response.json([{ cliente_id: 'client-contacted' }]);
    }
    if (url.pathname.endsWith('/rest/v1/estado_cartera_mensual')) {
      assert.equal(url.searchParams.get('estado'), 'eq.Resuelto');
      return Response.json([{ codigo_cliente: 'PAGADO' }]);
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;

  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer unit-test-agent-token' },
      query: { pais: 'GT' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body?.contactedClientCodes, ['CONTACTADO']);
    assert.deepEqual(response.body?.resolvedClientCodes, ['PAGADO']);
    assert.ok(requests.some((url) =>
      url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')
      && url.searchParams.get('agente_id') === 'eq.agent-1',
    ));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});
