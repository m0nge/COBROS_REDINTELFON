import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDailyAgendaRefillCandidates } from '../src/utils/dailyAgenda.ts';

const clients = (count: number) => Array.from(
  { length: count },
  (_, index) => ({ code: `CL${String(index + 1).padStart(6, '0')}` }),
);

function options(overrides: Partial<Parameters<typeof selectDailyAgendaRefillCandidates>[1]> = {}) {
  return {
    target: 40,
    dateKey: '2026-11-04',
    currentCodes: new Set<string>(),
    unavailableCodes: new Set<string>(),
    completedDailySlotKeys: new Set<string>(),
    explicitDateByCode: new Map<string, string>(),
    plannedCallCounts: new Map<string, number>(),
    priorityIndex: new Map<string, number>(),
    ...overrides,
  };
}

test('refills a 22-client agenda to 40 without duplicating clients', () => {
  const existing = clients(22);
  const priority = new Map(clients(80).map((client, index) => [client.code, index]));
  const selected = selectDailyAgendaRefillCandidates(clients(80), options({
    currentCodes: new Set(existing.map((client) => client.code)),
    priorityIndex: priority,
  }));

  assert.equal(existing.length + selected.length, 40);
  assert.equal(new Set([...existing, ...selected].map((client) => client.code)).size, 40);
});

test('20 completed calls plus 20 pending calls preserve the 40-call daily target', () => {
  const completed = clients(20);
  const existingPending = clients(20).slice(0, 13).map((client, index) => ({
    ...client,
    code: `PENDING${String(index + 1).padStart(2, '0')}`,
  }));
  const refillPool = clients(80).map((client, index) => ({
    ...client,
    code: `REFILL${String(index + 1).padStart(2, '0')}`,
  }));
  const selected = selectDailyAgendaRefillCandidates(refillPool, options({
    target: 20,
    currentCodes: new Set(existingPending.map((client) => client.code)),
    unavailableCodes: new Set(completed.map((client) => client.code)),
  }));

  assert.equal(existingPending.length + selected.length, 20);
  assert.equal(completed.length + existingPending.length + selected.length, 40);
});

test('does not pull a client forward from an explicit reschedule date', () => {
  const portfolio = clients(60);
  const explicitDateByCode = new Map([[portfolio[0].code, '2026-11-05']]);
  const selected = selectDailyAgendaRefillCandidates(portfolio, options({
    target: 40,
    explicitDateByCode,
    priorityIndex: new Map(portfolio.map((client, index) => [client.code, index])),
  }));

  assert.equal(selected.length, 40);
  assert.ok(!selected.some((client) => client.code === portfolio[0].code));
});

test('returns the available unique work when fewer than 40 eligible clients remain', () => {
  const portfolio = clients(35);
  const selected = selectDailyAgendaRefillCandidates(portfolio, options({
    target: 40,
    priorityIndex: new Map(portfolio.map((client, index) => [client.code, index])),
  }));

  assert.equal(selected.length, 35);
  assert.equal(new Set(selected.map((client) => client.code)).size, 35);
});
