import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterAgreementsByVerifiedEligibility,
  getPromisesForSanSyncThroughDate,
  getPromiseDisplayStatus,
  isResolvedInOrAfterPromiseMonth,
  latestPromisePerClient,
} from '../src/utils/latestPromise.ts';

test('active agreements require verified current arrears while fulfilled history stays visible', () => {
  const agreements = [
    { id: 'overdue', clientCode: 'CL001', status: 'Vencido' as const },
    { id: 'current-invoice-only', clientCode: 'CL002', status: 'Vencido' as const },
    { id: 'pending-current-only', clientCode: 'CL003', status: 'Pendiente' as const },
    { id: 'fulfilled-history', clientCode: 'CL004', status: 'Cumplido' as const },
  ];

  assert.deepEqual(
    filterAgreementsByVerifiedEligibility(agreements, ['cl001']),
    [agreements[0], agreements[3]],
  );
  assert.deepEqual(
    filterAgreementsByVerifiedEligibility(agreements, null),
    [agreements[3]],
  );
});

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

test('does not mark an unpaid promise overdue before the day after its promise date', () => {
  assert.equal(getPromiseDisplayStatus('unpaid', '2026-11-23', '2026-11-23', false), 'Pendiente');
  assert.equal(getPromiseDisplayStatus('unpaid', '2026-11-24', '2026-11-23', false), 'Pendiente');
  assert.equal(getPromiseDisplayStatus('unpaid', '2026-11-22', '2026-11-23', false), 'Vencido');
});

test('general SAN sync includes pending and overdue promises through the selected date', () => {
  const agreements = [
    { id: 'yesterday', promiseDate: '2026-11-25', status: 'Pendiente' },
    { id: 'today', promiseDate: '2026-11-26', status: 'Pendiente' },
    { id: 'tomorrow', promiseDate: '2026-11-27', status: 'Pendiente' },
    { id: 'overdue', promiseDate: '2026-11-24', status: 'Vencido' },
    { id: 'already-paid', promiseDate: '2026-11-24', status: 'Cumplido' },
  ];

  assert.deepEqual(
    getPromisesForSanSyncThroughDate(agreements, '2026-11-26', '2026-11-26').map(({ id }) => id),
    ['yesterday', 'overdue'],
  );
  assert.deepEqual(
    getPromisesForSanSyncThroughDate(agreements, '2026-11-23', '2026-11-26').map(({ id }) => id),
    [],
  );
});

test('a later monthly payment resolves an older promise without resolving a newer one', () => {
  const resolvedKeys = ['SV:CL001:2026-11', 'SV:CL002:2026-10'];
  assert.equal(
    isResolvedInOrAfterPromiseMonth(resolvedKeys, 'SV', 'cl001', '2026-09'),
    true,
  );
  assert.equal(
    isResolvedInOrAfterPromiseMonth(resolvedKeys, 'SV', 'CL001', '2026-12'),
    false,
  );
  assert.equal(
    isResolvedInOrAfterPromiseMonth(resolvedKeys, 'GT', 'CL001', '2026-10'),
    false,
  );
});
