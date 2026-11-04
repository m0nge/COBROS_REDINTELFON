import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthenticatedApiFetch } from '../src/services/authService.ts';

type TestSession = { access_token: string; expires_at: number };

function makeAuth(initialSession: TestSession | null) {
  let session = initialSession;
  let refreshCount = 0;
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      refreshSession: async () => {
        refreshCount += 1;
        session = {
          access_token: `refreshed-${refreshCount}`,
          expires_at: 5_000,
        };
        return { data: { session }, error: null };
      },
    },
    get refreshCount() {
      return refreshCount;
    },
  };
}

function response(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('proactively refreshes a nearly expired session before saving twice', async () => {
  const auth = makeAuth({ access_token: 'nearly-expired', expires_at: 1_010 });
  const tokens: string[] = [];
  const apiFetch = createAuthenticatedApiFetch(
    auth.auth,
    async (_input, init) => {
      tokens.push(new Headers(init?.headers).get('Authorization') || '');
      return response(200, { success: true, importedCount: 1 });
    },
    () => 1_000_000,
  );

  await apiFetch('/api/cartera?action=sync-gestiones', { method: 'POST', body: '{}' });
  await apiFetch('/api/cartera?action=sync-gestiones', { method: 'POST', body: '{}' });

  assert.deepEqual(tokens, ['Bearer refreshed-1', 'Bearer refreshed-1']);
  assert.equal(auth.refreshCount, 1);
});

test('retries one explicit app UNAUTHORIZED response with the refreshed token', async () => {
  const auth = makeAuth({ access_token: 'expired-on-server', expires_at: 5_000 });
  const tokens: string[] = [];
  let requestCount = 0;
  const apiFetch = createAuthenticatedApiFetch(
    auth.auth,
    async (_input, init) => {
      requestCount += 1;
      tokens.push(new Headers(init?.headers).get('Authorization') || '');
      return requestCount === 1
        ? response(401, { success: false, error: 'UNAUTHORIZED' })
        : response(200, { success: true, importedCount: 1 });
    },
    () => 1_000_000,
  );

  const result = await apiFetch('/api/cartera?action=sync-gestiones', {
    method: 'POST',
    body: '{}',
  });

  assert.equal(result.status, 200);
  assert.deepEqual(tokens, ['Bearer expired-on-server', 'Bearer refreshed-1']);
  assert.equal(requestCount, 2);
});

test('does not replay a write rejected for a non-authentication reason', async () => {
  const auth = makeAuth({ access_token: 'valid-token', expires_at: 5_000 });
  let requestCount = 0;
  const apiFetch = createAuthenticatedApiFetch(
    auth.auth,
    async () => {
      requestCount += 1;
      return response(401, { success: false, error: 'CLIENT_ACCESS_DENIED' });
    },
    () => 1_000_000,
  );

  const result = await apiFetch('/api/cartera?action=sync-gestiones', {
    method: 'POST',
    body: '{}',
  });

  assert.equal(result.status, 401);
  assert.equal(requestCount, 1);
  assert.equal(auth.refreshCount, 0);
});

test('fails before sending a write when no session can be refreshed', async () => {
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: async () => ({ data: { session: null }, error: new Error('refresh failed') }),
  };
  let requestCount = 0;
  const apiFetch = createAuthenticatedApiFetch(
    auth,
    async () => {
      requestCount += 1;
      return response(200, { success: true });
    },
    () => 1_000_000,
  );

  await assert.rejects(
    apiFetch('/api/cartera?action=sync-gestiones', { method: 'POST', body: '{}' }),
    /la gestión no se guardó/i,
  );
  assert.equal(requestCount, 0);
});
