import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFutureAgendaUnavailableCodes,
  filterAgendaClientsByPositiveMora,
  filterAgendaSlotsByPriorInvoice,
  preserveCompletedDailySlots,
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

test('filters current and future days while leaving historical months unchanged', () => {
  const slots = clients(3).map((client) => ({ client }));
  const eligible = ['cl000001', 'CL000003'];
  const currentDay = filterAgendaSlotsByPriorInvoice(slots, eligible, {
    selectedMonthKey: '2026-11',
    currentMonthKey: '2026-11',
  });
  const history = filterAgendaSlotsByPriorInvoice(slots, eligible, {
    selectedMonthKey: '2026-10',
    currentMonthKey: '2026-11',
  });

  assert.deepEqual(currentDay.map((slot) => slot.client.code), ['CL000001', 'CL000003']);
  assert.deepEqual(history, slots);
});

test('current and future agenda candidates require verified prior invoices and positive displayed mora', () => {
  const clients = [
    { code: 'CURRENT-ONLY', daysArrears: 0 },
    { code: 'STALE-ZERO', daysArrears: 0 },
    { code: 'OVERDUE', daysArrears: 1 },
    { code: 'MORE-OVERDUE', daysArrears: 45 },
  ];

  assert.deepEqual(
    filterAgendaClientsByPositiveMora(
      clients,
      ['stale-zero', 'OVERDUE', 'MORE-OVERDUE'],
    ).map((client) => client.code),
    ['OVERDUE', 'MORE-OVERDUE'],
  );
});

test('fills future days with eligible clients and keeps saved day data unmodified', () => {
  const eligible = Array.from({ length: 45 }, (_, index) => ({
    code: `ELIGIBLE${String(index + 1).padStart(2, '0')}`,
  }));
  const ineligible = Array.from({ length: 15 }, (_, index) => ({
    code: `CURRENT${String(index + 1).padStart(2, '0')}`,
  }));
  const initiallyPlanned = [...ineligible, ...eligible]
    .slice(0, 40)
    .map((client) => ({ client }));
  const futureSlots = filterAgendaSlotsByPriorInvoice(
    initiallyPlanned,
    eligible.map((client) => client.code),
    {
      selectedMonthKey: '2026-11',
      currentMonthKey: '2026-11',
    },
  );
  const replacements = selectDailyAgendaRefillCandidates(eligible, options({
    dateKey: '2026-11-13',
    target: 40,
    currentCodes: new Set(futureSlots.map((slot) => slot.client.code)),
    priorityIndex: new Map(eligible.map((client, index) => [client.code, index])),
  }));
  const futureCodes = [...futureSlots, ...replacements].map((slot) =>
    'client' in slot ? slot.client.code : slot.code
  );

  assert.equal(futureCodes.length, 40);
  assert.equal(new Set(futureCodes).size, 40);
  assert.ok(futureCodes.every((code) => code.startsWith('ELIGIBLE')));

  const completedToday = [
    { client: eligible[0] },
    { client: ineligible[0] },
  ];
  const todaySlots = filterAgendaSlotsByPriorInvoice(
    completedToday,
    eligible.map((client) => client.code),
    {
      selectedMonthKey: '2026-11',
      currentMonthKey: '2026-11',
    },
  );
  assert.deepEqual(todaySlots, [{ client: eligible[0] }]);
  assert.equal(completedToday.length, 2, 'filtering the view does not mutate saved day data');
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

test('keeps a completed or paid client in the original slot for that day', () => {
  const planned = clients(5).map((client, index) => ({
    client,
    turnNumber: index + 1,
  }));
  const visible = preserveCompletedDailySlots(planned, {
    target: 4,
    dateKey: '2026-11-04',
    completedCodes: new Set(['CL000001']),
    resolvedCodes: new Set(['CL000001', 'CL000005']),
    completedDailySlotKeys: new Set(['2026-11-04:CL000001']),
  });

  assert.deepEqual(visible.map((slot) => slot.client.code), [
    'CL000001',
    'CL000002',
    'CL000003',
    'CL000004',
  ]);
  assert.equal(visible[0].turnNumber, 1);
});
