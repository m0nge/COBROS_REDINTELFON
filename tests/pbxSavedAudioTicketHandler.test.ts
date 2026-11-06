import assert from 'node:assert/strict';
import test from 'node:test';
import { pbxSavedManagementAudioTicketHandler } from '../server/routes/pbxCalls.ts';
import { verifyPbxAudioTicket } from '../server/pbx.ts';

const RECORD_ID = '2b92df89-5bba-4dab-9af5-8bb2b613ef2c';

type TestContext = {
  role?: 'admin' | 'agente';
  userAgentId?: string;
  managementAgentId?: string;
  country?: 'SV' | 'GT';
  recordCountry?: 'SV' | 'GT';
  assignedClient?: boolean;
  pbxCall?: Record<string, unknown> | null;
};

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

function makeRequestFetch(options: TestContext = {}) {
  const {
    role = 'agente',
    userAgentId = 'agent-1',
    managementAgentId = 'agent-1',
    country = 'SV',
    recordCountry = country,
    assignedClient = false,
    pbxCall = {
      uniqueId: '1793719096.5903',
      extension: '6031',
      date: '2026-11-03',
      recordingFile: '6031-1793719096.5903.wav',
    },
  } = options;
  const requests: Array<{ method: string; path: string }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    requests.push({ method, path: url.pathname.replace('/rest/v1/', '') });

    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'auth-user-1', email: 'agent@example.invalid' });
    }
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{
        id: userAgentId,
        auth_id: 'auth-user-1',
        nombre: 'Agent Example',
        email: 'agent@example.invalid',
        telefono: null,
        pais: country,
        rol: role,
        estado: 'activo',
        avatar_url: null,
        extension_pbx: '6031',
        tasa_efectividad: null,
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      return Response.json([{
        id: RECORD_ID,
        agente_id: managementAgentId,
        valores_dinamicos: pbxCall ? { pbxCall } : {},
        clientes: { codigo: 'CL001', pais: recordCountry },
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return Response.json(assignedClient ? [{ codigo_cliente: 'CL001' }] : []);
    }
    throw new Error(`Unexpected test request ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { fakeFetch, requests };
}

async function runHandler(options: TestContext = {}) {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { fakeFetch, requests } = makeRequestFetch(options);
  globalThis.fetch = fakeFetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  const response = responseRecorder();

  try {
    await pbxSavedManagementAudioTicketHandler({
      method: 'GET',
      headers: { authorization: 'Bearer unit-test-access-token' },
      query: { gestion_id: RECORD_ID },
    }, response);
    return { response, requests };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
}

function ticketFromResponse(response: ReturnType<typeof responseRecorder>) {
  const url = new URL(String(response.body?.audioUrl || ''), 'https://app.example.invalid');
  return url.searchParams.get('ticket') || '';
}

test('issues a fresh signed audio ticket for an agent’s own persisted management', async () => {
  const { response } = await runHandler();

  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body?.success, true);
  assert.equal(
    verifyPbxAudioTicket(ticketFromResponse(response), 'unit-test-only')?.uniqueId,
    '1793719096.5903',
  );
});

test('allows an admin to issue an audio ticket for a management in the admin’s country', async () => {
  const { response, requests } = await runHandler({
    role: 'admin',
    userAgentId: 'admin-1',
    managementAgentId: 'agent-2',
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(
    verifyPbxAudioTicket(ticketFromResponse(response), 'unit-test-only')?.agentId,
    'agent-2',
  );
  assert.equal(requests.some((request) => request.path === 'asignaciones_cartera_fija'), false);
});

test('requires an assigned client before an agent can listen to another agent’s shared management', async () => {
  const { response, requests } = await runHandler({
    userAgentId: 'agent-1',
    managementAgentId: 'agent-2',
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body?.error, 'CLIENT_ACCESS_DENIED');
  assert.equal(requests.some((request) => request.path === 'asignaciones_cartera_fija'), true);
});

test('allows an assigned agent to listen to shared management and blocks another country', async () => {
  const assigned = await runHandler({
    managementAgentId: 'agent-2',
    assignedClient: true,
  });
  assert.equal(assigned.response.statusCode, 200, JSON.stringify(assigned.response.body));

  const crossCountry = await runHandler({
    role: 'admin',
    userAgentId: 'admin-1',
    managementAgentId: 'agent-2',
    country: 'GT',
    recordCountry: 'SV',
  });
  assert.equal(crossCountry.response.statusCode, 403);
  assert.equal(crossCountry.response.body?.error, 'COUNTRY_ACCESS_DENIED');
});

test('does not issue an audio ticket when the saved record has no linked PBX call', async () => {
  const { response } = await runHandler({ pbxCall: null });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body?.error, 'PBX_CALL_NOT_LINKED');
  assert.equal(response.body?.audioUrl, undefined);
});
