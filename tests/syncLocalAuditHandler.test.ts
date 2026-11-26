import assert from 'node:assert/strict';
import test from 'node:test';
import syncLocalAuditHandler from '../server/routes/syncLocalAudit.ts';

test('persists a live management using only columns in the documented schema', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSanTelemanagementKey = process.env.SAN_TELEGESTION_API_KEY;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const timestamp = new Date(`${today}T10:00:00-06:00`).toISOString();
  const nextDay = new Date(`${today}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayKey = nextDay.toISOString().slice(0, 10);
  const promiseDate = nextDayKey.slice(0, 7) === today.slice(0, 7) ? nextDayKey : today;
  const requests: Array<{ method: string; url: string }> = [];
  let insertedRows: Array<Record<string, any>> = [];
  const sanBodies: Array<Record<string, unknown>> = [];

  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  process.env.SAN_TELEGESTION_API_KEY = 'unit-test-only';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    requests.push({ method, url: url.toString() });

    if (url.hostname === 'san.red.com.sv' && url.pathname === '/API/InsertarTelegestion') {
      sanBodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response('OK', { status: 200 });
    }
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
        extension_pbx: null,
        tasa_efectividad: null,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return Response.json([{ codigo_cliente: 'CL001' }]);
    }
    if (url.pathname.endsWith('/rest/v1/clientes')) {
      return Response.json([{ id: 'client-1', codigo: 'CL001' }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      if (method === 'POST') {
        insertedRows = JSON.parse(String(init?.body || '[]'));
        return Response.json(
          insertedRows.map((row, index) => ({ ...row, id: `management-${index + 1}` })),
          { status: 201 },
        );
      }
      return Response.json([]);
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  }) as typeof fetch;

  const response = {
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

  try {
    await syncLocalAuditHandler({
      method: 'POST',
      headers: { authorization: 'Bearer unit-test-access-token' },
      body: {
        pais: 'SV',
        mode: 'commit',
        source: 'live',
        records: [{
          id: 'audit-test-1',
          timestamp,
          date: today,
          scheduledForDate: today,
          time: '10:00',
          agentId: 'agent-1',
          agentName: 'Agent Example',
          clientCode: 'CL001',
          clientName: 'Client Example',
          country: 'SV',
          channel: 'WhatsApp',
          contactSuccess: 'Si',
          agreement: 'Promesa de Pago',
          committedAmount: 125,
          deadlineDate: promiseDate,
          observations: 'Test management',
          status: 'Contactado',
          dynamicValues: {
            localAuditId: 'audit-test-1',
            scheduledForDate: today,
            contactChannel: 'WhatsApp',
            promiseTime: '10:00',
          },
        }],
      },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.success, true);
    assert.equal(response.body?.importedCount, 1);
    assert.equal(response.body?.sanSync?.status, 'saved');
    assert.equal(insertedRows.length, 1);
    assert.equal(sanBodies.length, 1);
    assert.equal(sanBodies[0].Codigo_Cliente, 'CL001');
    assert.equal(sanBodies[0].Tipo_Gestion, 200);
    assert.equal(sanBodies[0].Gestionado, 'S');
    assert.equal(insertedRows[0].fecha_agendada, undefined);
    assert.equal(insertedRows[0].valores_dinamicos.scheduledForDate, today);
    assert.equal(requests.some((request) => request.url.includes('fecha_agendada')), false);
    assert.equal(
      requests.filter((request) =>
        request.method === 'POST' && request.url.includes('/rest/v1/bitacora_gestiones')
      ).length,
      1,
    );
    assert.ok(
      requests.findIndex((request) => request.url.includes('/rest/v1/bitacora_gestiones'))
      < requests.findIndex((request) => request.url.includes('/API/InsertarTelegestion')),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    if (originalSanTelemanagementKey === undefined) delete process.env.SAN_TELEGESTION_API_KEY;
    else process.env.SAN_TELEGESTION_API_KEY = originalSanTelemanagementKey;
  }
});
