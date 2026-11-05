import assert from 'node:assert/strict';
import test from 'node:test';
import { supabaseRestRequest } from '../server/supabaseAuth.ts';

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
