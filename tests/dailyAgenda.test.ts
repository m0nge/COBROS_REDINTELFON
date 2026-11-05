import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFutureAgendaUnavailableCodes,
  selectDailyAgendaRefillCandidates,
} from '../src/utils/dailyAgenda.ts';

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

test('keeps promise clients available for future follow-ups but excludes paid clients', () => {
  const unavailable = buildFutureAgendaUnavailableCodes(
    ['cl000001'],
    [
      {
        clientCode: 'CL000002',
        agreement: 'Promesa de Pago',
        assignedDate: '2026-11-04',
        countable: true,
      },
      {
        clientCode: 'CL000003',
        agreement: 'Pago realizado',
        assignedDate: '2026-11-04',
        countable: true,
      },
      {
        clientCode: 'CL000004',
        agreement: 'Pago realizado',
        assignedDate: '2026-11-04',
        countable: false,
      },
      {
        clientCode: 'CL000005',
        agreement: 'Pago realizado',
        assignedDate: '2026-10-31',
        countable: true,
      },
    ],
    '2026-11',
  );

  assert.deepEqual([...unavailable].sort(), ['CL000001', 'CL000003']);
});

test('can still fill 40 future slots when most earlier contacts were promises', () => {
  const portfolio = clients(44);
  const promiseRecords = portfolio.slice(0, 32).map((client) => ({
    clientCode: client.code,
    agreement: 'Promesa de Pago',
    assignedDate: '2026-11-04',
    countable: true,
  }));
  const unavailableCodes = buildFutureAgendaUnavailableCodes([], promiseRecords, '2026-11');
  const selected = selectDailyAgendaRefillCandidates(portfolio, options({
    dateKey: '2026-11-05',
    unavailableCodes,
    priorityIndex: new Map(portfolio.map((client, index) => [client.code, index])),
  }));

  assert.equal(selected.length, 40);
  assert.ok(selected.some((client) => client.code === 'CL000001'));
});

test('does not repeat a completed promise on its own day but allows a later follow-up', () => {
  const portfolio = clients(2);
  const unavailableCodes = buildFutureAgendaUnavailableCodes([], [{
    clientCode: portfolio[0].code,
    agreement: 'Promesa de Pago',
    assignedDate: '2026-11-04',
    countable: true,
  }], '2026-11');
  const completedDailySlotKeys = new Set(['2026-11-04:CL000001']);
  const priorityIndex = new Map(portfolio.map((client, index) => [client.code, index]));

  const sameDay = selectDailyAgendaRefillCandidates(portfolio, options({
    target: 1,
    dateKey: '2026-11-04',
    unavailableCodes,
    completedDailySlotKeys,
    priorityIndex,
  }));
  const futureDay = selectDailyAgendaRefillCandidates(portfolio, options({
    target: 1,
    dateKey: '2026-11-05',
    unavailableCodes,
    completedDailySlotKeys,
    priorityIndex,
  }));

  assert.deepEqual(sameDay.map((client) => client.code), ['CL000002']);
  assert.deepEqual(futureDay.map((client) => client.code), ['CL000001']);
});
