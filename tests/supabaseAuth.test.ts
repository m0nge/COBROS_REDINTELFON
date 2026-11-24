import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateAgentRequest, supabaseRestRequest } from '../server/supabaseAuth.ts';

test('surfaces only a safe database error code instead of the raw Supabase response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      code: '42703',
      message: 'raw upstream details must not be returned',
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;

  try {
    await assert.rejects(
      supabaseRestRequest(
        'bitacora_gestiones',
        { method: 'POST', body: '{}' },
        { supabaseUrl: 'https://supabase.example.invalid', serviceRoleKey: 'unit-test-only' },
      ),
      (error: any) => error.code === 'DATABASE_REQUEST_FAILED'
        && error.status === 400
        && error.message.includes('columna requerida')
        && error.message.includes('42703')
        && !error.message.includes('raw upstream details'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports an auth service outage as retryable instead of an expired session', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{}', { status: 502 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      authenticateAgentRequest({ headers: { authorization: 'Bearer token' } }),
      (error: any) => error.code === 'AUTH_UNAVAILABLE' && error.status === 503,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
