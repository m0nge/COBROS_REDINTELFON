import assert from 'node:assert/strict';
import test from 'node:test';
import corroborarPromesaHandler from '../server/routes/corroborarPromesa.ts';

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

function dateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function makeFetch(promiseDate: string) {
  const today = dateKey(new Date());
  const month = today.slice(0, 7);
  const requests: Array<{ method: string; path: string; body?: Record<string, any> }> = [];
  let savedPromiseValues: Record<string, any> = {
    periodMonth: month,
    scheduledForDate: `${month}-01`,
  };
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname, body });

    if (url.pathname.endsWith('/auth/v1/user')) {
      return Response.json({ id: 'auth-user-1', email: 'agent@example.invalid' });
    }
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return Response.json([{
        id: 'agent-1',
        auth_id: 'auth-user-1',
        nombre: 'Agent Example',
        email: 'agent@example.invalid',
        pais: 'SV',
        rol: 'agente',
        estado: 'activo',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return Response.json([{ codigo_cliente: 'CL001' }]);
    }
    if (url.pathname.endsWith('/rest/v1/clientes')) {
      return Response.json([{ id: 'client-1' }]);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      if (method === 'PATCH') {
        savedPromiseValues = body?.valores_dinamicos;
        return new Response(null, { status: 204 });
      }
      return Response.json([{
        id: 'promise-1',
        fecha_limite_pago: promiseDate,
        created_at: new Date(`${today}T12:00:00-06:00`).toISOString(),
        valores_dinamicos: savedPromiseValues,
      }]);
    }
    if (url.hostname === 'san.red.com.sv') {
      return Response.json([{
        fechaEmision: `${month}-01`,
        estado: 'PAGADO',
        valordoc: '150.00',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/estado_cartera_mensual')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { fakeFetch, requests, month, getSavedPromiseValues: () => savedPromiseValues };
}

test('corroborates a due promise and persists both promise status and monthly recovery', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSanApiKey = process.env.SAN_API_KEY;
  const today = dateKey(new Date());
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const { fakeFetch, requests, month, getSavedPromiseValues } = makeFetch(yesterday);
  globalThis.fetch = fakeFetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  process.env.SAN_API_KEY = 'san-test-only';
  const response = responseRecorder();

  try {
    await corroborarPromesaHandler({
      method: 'POST',
      headers: { authorization: 'Bearer unit-test-access-token' },
      body: { pais: 'SV', codigo_cliente: 'CL001' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.status, 'Cumplido');
    assert.equal(response.body?.monto_recuperado, 150);
    const monthlyWrite = requests.find((request) =>
      request.path.endsWith('/rest/v1/estado_cartera_mensual')
    );
    assert.equal(monthlyWrite?.body?.estado, 'Resuelto');
    assert.equal(monthlyWrite?.body?.monto_recuperado, 150);
    assert.equal(getSavedPromiseValues().promiseVerificationStatus, 'paid');
    assert.ok(getSavedPromiseValues().promiseVerifiedAt);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    if (originalSanApiKey === undefined) delete process.env.SAN_API_KEY;
    else process.env.SAN_API_KEY = originalSanApiKey;
  }
});

test('does not query SAN or write state on the promise date', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSanApiKey = process.env.SAN_API_KEY;
  const today = dateKey(new Date());
  const { fakeFetch, requests } = makeFetch(today);
  globalThis.fetch = fakeFetch;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  process.env.SAN_API_KEY = 'san-test-only';
  const response = responseRecorder();

  try {
    await corroborarPromesaHandler({
      method: 'POST',
      headers: { authorization: 'Bearer unit-test-access-token' },
      body: { pais: 'SV', codigo_cliente: 'CL001' },
    }, response);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body?.error, 'PROMISE_NOT_DUE');
    assert.equal(requests.some((request) => request.path.includes('san.red.com.sv')), false);
    assert.equal(requests.some((request) =>
      request.method === 'POST' || request.method === 'PATCH'
    ), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    if (originalSanApiKey === undefined) delete process.env.SAN_API_KEY;
    else process.env.SAN_API_KEY = originalSanApiKey;
  }
});
