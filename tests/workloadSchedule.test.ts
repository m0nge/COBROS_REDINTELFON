import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '../src/types.ts';
import {
  buildWorkloadSchedule1To22,
  getOperationalBusinessDayNumbers,
  normalizeToBusinessDay,
} from '../src/utils/moraLogic.ts';

function makeClient(code: string): Client {
  return {
    code,
    name: `Cliente ${code}`,
    country: 'SV',
    totalDebt: 1000,
    debtVerified: true,
    daysArrears: 60,
    moraRange: '31-60',
    state: 'Pendiente',
    priority: 'Normal',
    invoiceDate: '',
    dueDate: '',
  };
}

test('daily assignments stay deterministic when equal-priority clients arrive in a different order', () => {
  const source = Array.from({ length: 90 }, (_, index) =>
    makeClient(`CL${String(index + 1).padStart(6, '0')}`)
  );
  const shuffled = [...source].reverse();
  const describe = (clients: Client[]) => {
    const schedule = buildWorkloadSchedule1To22(clients, 2026, 10, 8);
    return Object.entries(schedule)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([day, slots]) => [
        day,
        slots.map((slot) => `${slot.client.code}:${slot.callRound}:${slot.turnNumber}`),
      ]);
  };

  assert.deepEqual(describe(source), describe(shuffled));
});

test('assigns only weekdays and keeps the 40-call quota on each operational day', () => {
  const source = Array.from({ length: 120 }, (_, index) =>
    makeClient(`CL${String(index + 1).padStart(6, '0')}`)
  );
  const schedule = buildWorkloadSchedule1To22(source, 2026, 10, 40);

  for (let day = 1; day <= 22; day++) {
    const weekday = new Date(Date.UTC(2026, 10, day, 12)).getUTCDay();
    const slots = schedule[day] || [];
    if (weekday === 0 || weekday === 6) {
      assert.equal(slots.length, 0, `day ${day} is a weekend`);
    } else {
      assert.equal(slots.length, 40, `day ${day} is a business day`);
      assert.equal(new Set(slots.map((slot) => slot.client.code)).size, 40);
    }
  }
});

test('weekday calendar skips weekends and normalizes a weekend date within the 1–22 window', () => {
  const businessDays = getOperationalBusinessDayNumbers(2026, 10);

  assert.deepEqual(businessDays, [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20]);
  assert.equal(normalizeToBusinessDay(2026, 10, 7), 9);
  assert.equal(normalizeToBusinessDay(2026, 10, 21), 20);
  assert.equal(normalizeToBusinessDay(2026, 10, 21, 30), 23);
});
