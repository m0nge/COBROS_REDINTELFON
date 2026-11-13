import assert from 'node:assert/strict';
import test from 'node:test';
import { latestPromisePerClient } from '../src/utils/latestPromise.ts';

test('shows only the newest promise per customer while keeping other customers', () => {
  const latest = latestPromisePerClient([
    {
      id: 'old',
      country: 'SV',
      clientCode: 'CL001',
      createdAt: '2026-11-04T10:00:00.000Z',
      promiseDate: '2026-11-06',
    },
    {
      id: 'other-client',
      country: 'SV',
      clientCode: 'CL002',
      createdAt: '2026-11-04T11:00:00.000Z',
    },
    {
      id: 'new',
      country: 'SV',
      clientCode: 'cl001',
      createdAt: '2026-11-05T10:00:00.000Z',
      promiseDate: '2026-11-12',
    },
  ]);

  assert.deepEqual(latest.map((record) => record.id), ['new', 'other-client']);
  assert.equal(latest[0].promiseDate, '2026-11-12');
});
