import assert from 'node:assert/strict';
import test from 'node:test';
import { isNewDateWithinCurrentManagementMonth } from '../server/managementDates.ts';

test('new promise and reschedule dates stay in the current management month', () => {
  assert.equal(
    isNewDateWithinCurrentManagementMonth('2026-11-18', '2026-11-25', '2026-11-23'),
    true,
  );
  assert.equal(
    isNewDateWithinCurrentManagementMonth('2026-11-18', '2026-12-01', '2026-11-23'),
    false,
  );
  assert.equal(
    isNewDateWithinCurrentManagementMonth('2026-11-18', '2026-11-22', '2026-11-23'),
    false,
  );
  assert.equal(
    isNewDateWithinCurrentManagementMonth('2026-12-01', '2026-12-10', '2026-11-23'),
    false,
  );
});

test('editing can preserve an existing historical date without extending the agenda', () => {
  assert.equal(
    isNewDateWithinCurrentManagementMonth('2026-11-18', '2026-11-20', '2026-12-01', '2026-11-20'),
    true,
  );
  assert.equal(
    isNewDateWithinCurrentManagementMonth('2026-11-18', '2026-12-10', '2026-12-01', '2026-11-20'),
    false,
  );
});
