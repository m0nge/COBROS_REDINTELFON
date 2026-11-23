import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../server/routes/adminGestiones.ts';

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

test('admin audit pagination orders ties by id and retains every row', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auditRequests: URL[] = [];
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'auth-admin' });
    }
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{
        id: 'admin-1',
        auth_id: 'auth-admin',
        nombre: 'Admin Example',
        email: 'admin@example.invalid',
        pais: 'SV',
        rol: 'admin',
        estado: 'activo',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      auditRequests.push(url);
      const offset = Number(url.searchParams.get('offset') || 0);
      const count = offset === 0 ? 1000 : 1;
      return Response.json(Array.from({ length: count }, (_, index) => {
        const rowNumber = offset + index;
        return {
          id: `row-${String(rowNumber).padStart(4, '0')}`,
          agente_id: 'agent-1',
          tipo_gestion: 'WhatsApp',
          contacto_exitoso: 'Si',
          acuerdo: 'Sin Acuerdo',
          created_at: '2026-11-25T16:00:00.000Z',
          valores_dinamicos: { scheduledForDate: '2026-11-25' },
          clientes: { codigo: `CL${rowNumber}`, nombre: `Cliente ${rowNumber}`, pais: 'SV' },
          agentes: { nombre: 'Agent Example', email: 'agent@example.invalid' },
        };
      }));
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;

  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer unit-test-admin-token' },
      query: { action: 'gestiones', pais: 'SV' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.records.length, 1001);
    assert.equal(response.body?.truncated, false);
    assert.equal(auditRequests.length, 2);
    assert.equal(auditRequests[0].searchParams.get('order'), 'created_at.desc,id.desc');
    assert.equal(auditRequests[1].searchParams.get('offset'), '1000');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});
