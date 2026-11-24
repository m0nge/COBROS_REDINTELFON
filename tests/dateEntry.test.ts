import assert from 'node:assert/strict';
import test from 'node:test';
import { dateEntryRangeError, formatDateEntry, parseDateEntry } from '../src/utils/dateEntry.ts';

test('accepts typed day/month/year, ISO, and unpadded day/month dates', () => {
  assert.equal(parseDateEntry('09/02/2026'), '2026-02-09');
  assert.equal(parseDateEntry('09022026'), '2026-02-09');
  assert.equal(parseDateEntry('2026-02-09'), '2026-02-09');
  assert.equal(parseDateEntry('9.2.2026'), '2026-02-09');
  assert.equal(formatDateEntry('2026-02-09'), '09/02/2026');
});

test('rejects impossible dates and checks typed dates against the picker range', () => {
  assert.equal(parseDateEntry('31/02/2026'), null);
  assert.equal(parseDateEntry('29/02/2024'), '2024-02-29');
  assert.equal(dateEntryRangeError('2026-11-20', '2026-11-21', '2026-11-30'), 'La fecha no puede ser anterior a 21/11/2026.');
  assert.equal(dateEntryRangeError('2026-12-01', '2026-11-01', '2026-11-30'), 'La fecha no puede ser posterior a 30/11/2026.');
});
