import assert from 'node:assert/strict';
import test from 'node:test';
import pagoRealizadoHandler from '../server/routes/pagoRealizado.ts';

function recorder() {
  return {
    statusCode: 200,
    body: null as Record<string, any> | null,
    setHeader() {},
    status(code: number) { this.statusCode = code; return this; },
    json(body: Record<string, any>) { this.body = body; return this; },
  };
}

test('admin payment registration from Escalados rejects clients without an open escalation', async () => {
  const original = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'auth-1' });
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{ id: 'admin-1', auth_id: 'auth-1', nombre: 'Admin', email: 'admin@example.invalid', pais: 'SV', rol: 'admin', estado: 'activo' }]);
    }
    if (url.pathname.endsWith('/rest/v1/escalaciones_criticas')) return Response.json([]);
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;

  try {
    const res = recorder();
    await pagoRealizadoHandler({
      method: 'POST',
      headers: { authorization: 'Bearer unit-test' },
      body: {
        pais: 'SV', codigo_cliente: 'CL001', mes: '2026-11', fecha_pago: '2026-11-25',
        persona_pago: 'Cliente', tipo_gestion: 'Email', escalado: true,
      },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error, 'CLIENT_NOT_ESCALATED');
  } finally {
    globalThis.fetch = original;
  }
});
