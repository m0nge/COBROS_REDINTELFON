import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '../src/types.ts';
import { buildWorkloadSchedule1To22 } from '../src/utils/moraLogic.ts';

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
    const schedule = buildWorkloadSchedule1To22(clients, 8);
    return Object.entries(schedule)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([day, slots]) => [
        day,
        slots.map((slot) => `${slot.client.code}:${slot.callRound}:${slot.turnNumber}`),
      ]);
  };

  assert.deepEqual(describe(source), describe(shuffled));
});
