import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFutureAgendaUnavailableCodes,
  buildDailyAgendaPriorityCodes,
  buildLatestExplicitRescheduleDates,
  buildLateMonthFollowUpCodes,
  buildOverdueUnpaidPromiseCodes,
  buildPromiseUnavailableCodes,
  calculateDailyAgendaProgress,
  filterAgendaClientsByInvoiceEligibility,
  filterAgendaClientsByVerifiedMora,
  filterAgendaSlotsByPriorInvoice,
  keepEligibleAgendaFollowUps,
  preserveCompletedDailySlots,
  selectDailyAgendaRefillCandidates,
} from '../src/utils/dailyAgenda.ts';
import { isFutureRescheduleDateWithinMonth } from '../src/utils/gestionDates.ts';

const clients = (count: number) => Array.from(
  { length: count },
  (_, index) => ({ code: `CL${String(index + 1).padStart(6, '0')}` }),
);

test('future reschedules are allowed through month end, including after day 21', () => {
  assert.equal(isFutureRescheduleDateWithinMonth('2026-11-26', '2026-11-23', '2026-11-30'), true);
  assert.equal(isFutureRescheduleDateWithinMonth('2026-11-22', '2026-11-23', '2026-11-30'), false);
  assert.equal(isFutureRescheduleDateWithinMonth('2026-12-01', '2026-11-23', '2026-11-30'), false);
  assert.equal(isFutureRescheduleDateWithinMonth('2026-11-31', '2026-11-23', '2026-11-30'), false);
});

test('daily completion is measured against the work actually assigned when fewer than quota', () => {
  assert.deepEqual(calculateDailyAgendaProgress(17, 17, 40, true), {
    goal: 17,
    percentage: 100,
    shortfall: 23,
  });
  assert.deepEqual(calculateDailyAgendaProgress(22, 25, 40, true), {
    goal: 25,
    percentage: 88,
    shortfall: 15,
  });
  assert.deepEqual(calculateDailyAgendaProgress(3, 3, 40, false), {
    goal: 3,
    percentage: 100,
    shortfall: 0,
  });
  assert.deepEqual(calculateDailyAgendaProgress(0, 0, 40, false), {
    goal: 0,
    percentage: 0,
    shortfall: 0,
  });
});

test('late-month follow-ups include only the latest promise verified as unpaid after its deadline', () => {
  const promise = {
    clientCode: 'CL-PROMISE',
    agreement: 'Promesa de Pago',
    assignedDate: '2026-11-20',
    deadlineDate: '2026-11-21',
    timestamp: '2026-11-20T16:00:00.000Z',
    promiseVerificationStatus: 'unpaid',
    countable: true,
  };
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([promise], '2026-11-21')], []);
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([promise], '2026-11-22')], ['CL-PROMISE']);
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([{
    ...promise,
    promiseVerificationStatus: 'paid',
  }], '2026-11-22')], []);
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([{
    ...promise,
    promiseVerificationStatus: 'unknown',
  }], '2026-11-22')], []);
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([
    promise,
    {
      ...promise,
      agreement: 'Sin Acuerdo',
      deadlineDate: '',
      timestamp: '2026-11-22T16:00:00.000Z',
    },
  ], '2026-11-23')], []);
  const verifiedLater = {
    ...promise,
    promiseVerifiedAt: '2026-11-24T06:30:00.000Z',
  };
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([verifiedLater], '2026-11-23')], []);
  assert.deepEqual([...buildOverdueUnpaidPromiseCodes([verifiedLater], '2026-11-24')], ['CL-PROMISE']);
  assert.deepEqual([...buildPromiseUnavailableCodes([verifiedLater], '2026-11-23')], ['CL-PROMISE']);
  assert.deepEqual([...buildPromiseUnavailableCodes([verifiedLater], '2026-11-24')], []);
});

test('late-month agenda excludes routine clients and holds active promises', () => {
  const records = [
    {
      clientCode: 'CL-NO-ANSWER',
      agreement: 'Sin Acuerdo',
      assignedDate: '2026-11-17',
      timestamp: '2026-11-17T16:00:00.000Z',
      countable: true,
    },
    {
      clientCode: 'CL-ACTIVE-PROMISE',
      agreement: 'Promesa de Pago',
      assignedDate: '2026-11-20',
      deadlineDate: '2026-11-25',
      timestamp: '2026-11-20T16:00:00.000Z',
      countable: true,
      promiseVerificationStatus: 'unknown',
    },
    {
      clientCode: 'CL-OVERDUE-PROMISE',
      agreement: 'Promesa de Pago',
      assignedDate: '2026-11-20',
      deadlineDate: '2026-11-22',
      timestamp: '2026-11-20T15:00:00.000Z',
      countable: true,
      promiseVerificationStatus: 'unpaid',
    },
  ];
  const dateKey = '2026-11-24';
  const duePromises = buildOverdueUnpaidPromiseCodes(records, dateKey);
  const heldPromises = buildPromiseUnavailableCodes(records, dateKey);

  assert.deepEqual(
    buildLateMonthFollowUpCodes(
      ['CL-NO-ANSWER', 'CL-NEVER-MANAGED', 'CL-ACTIVE-PROMISE', 'CL-OVERDUE-PROMISE'],
      records,
      {
        dateKey,
        completedCodes: [],
        resolvedCodes: [],
        unavailablePromiseCodes: heldPromises,
        overdueUnpaidPromiseCodes: duePromises,
      },
    ),
    ['CL-OVERDUE-PROMISE'],
  );
});

test('late-month follow-up honors the latest saved no-contact reschedule date', () => {
  const records = [
    {
      clientCode: 'CL-RESCHEDULED',
      agreement: 'Sin Acuerdo',
      assignedDate: '2026-11-23',
      rescheduleDate: '2026-11-26',
      status: 'Reprogramado',
      timestamp: '2026-11-23T16:00:00.000Z',
      countable: true,
    },
  ];
  const explicitDateByCode = buildLatestExplicitRescheduleDates(records, '2026-11');
  assert.equal(explicitDateByCode.get('CL-RESCHEDULED'), '2026-11-26');
  assert.deepEqual(buildLateMonthFollowUpCodes(
    ['CL-RESCHEDULED'],
    records,
    {
      dateKey: '2026-11-25',
      completedCodes: [],
      resolvedCodes: [],
      unavailablePromiseCodes: [],
      overdueUnpaidPromiseCodes: [],
      explicitDateByCode,
    },
  ), []);
  assert.deepEqual(buildLateMonthFollowUpCodes(
    ['CL-RESCHEDULED'],
    records,
    {
      dateKey: '2026-11-26',
      completedCodes: [],
      resolvedCodes: [],
      unavailablePromiseCodes: [],
      overdueUnpaidPromiseCodes: [],
      explicitDateByCode,
    },
  ), ['CL-RESCHEDULED']);
  assert.deepEqual([...buildLatestExplicitRescheduleDates([
    ...records,
    {
      clientCode: 'CL-RESCHEDULED',
      agreement: 'Sin Acuerdo',
      assignedDate: '2026-11-24',
      status: 'Contactado',
      timestamp: '2026-11-24T16:00:00.000Z',
      countable: true,
    },
  ], '2026-11')], [['CL-RESCHEDULED', null]]);
});

test('late-month follow-ups include only due reschedules or unpaid promises', () => {
  assert.deepEqual(
    buildLateMonthFollowUpCodes(
      ['CL-DONE', 'CL-PAID', 'CL-RESCHEDULED', 'CL-READY'],
      [],
      {
        dateKey: '2026-11-24',
        completedCodes: ['CL-DONE'],
        resolvedCodes: ['CL-PAID'],
        unavailablePromiseCodes: [],
        overdueUnpaidPromiseCodes: [],
        explicitDateByCode: new Map([['cl-rescheduled', '2026-11-25']]),
      },
    ),
    [],
  );
  assert.deepEqual(
    buildLateMonthFollowUpCodes(
      ['CL-RESCHEDULED'],
      [],
      {
        dateKey: '2026-11-25',
        completedCodes: [],
        resolvedCodes: [],
        unavailablePromiseCodes: [],
        overdueUnpaidPromiseCodes: [],
        explicitDateByCode: new Map([['cl-rescheduled', '2026-11-25']]),
      },
    ),
    ['CL-RESCHEDULED'],
  );
});

test('late-month follow-up keeps an assigned unpaid promise even outside routine invoice eligibility', () => {
  const promiseCode = 'CL-PROMISE-NO-ROUTINE-ELIGIBILITY';
  assert.deepEqual(
    buildLateMonthFollowUpCodes(
      [promiseCode],
      [{
        clientCode: promiseCode,
        agreement: 'Promesa de Pago',
        assignedDate: '2026-11-10',
        deadlineDate: '2026-11-20',
        promiseVerificationStatus: 'unpaid',
        promiseVerifiedAt: '2026-11-21T08:00:00-06:00',
        countable: true,
      }],
      {
        dateKey: '2026-11-23',
        completedCodes: [],
        resolvedCodes: [],
        unavailablePromiseCodes: [],
        overdueUnpaidPromiseCodes: [promiseCode],
      },
    ),
    [promiseCode],
  );
});

test('future daily agenda puts overdue promises before due reschedules and routine work', () => {
  assert.deepEqual(buildDailyAgendaPriorityCodes(
    ['CL-ROUTINE', 'CL-RESCHEDULED', 'CL-OVERDUE', 'CL-COMPLETED', 'CL-HELD'],
    {
      dateKey: '2026-11-25',
      explicitDateByCode: new Map([
        ['CL-RESCHEDULED', '2026-11-24'],
        ['CL-ROUTINE', '2026-11-26'],
      ]),
      overdueUnpaidPromiseCodes: new Set(['CL-OVERDUE', 'CL-HELD']),
      completedCodes: new Set(['CL-COMPLETED']),
      unavailableCodes: new Set(['CL-HELD']),
    },
  ), ['CL-OVERDUE', 'CL-RESCHEDULED']);
});

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

test('tops up today without changing existing assigned rows or repeating a client', () => {
  const existing = clients(9);
  const portfolio = clients(50);
  const selected = selectDailyAgendaRefillCandidates(portfolio, options({
    dateKey: '2026-11-16',
    currentCodes: new Set(existing.map((client) => client.code)),
    completedDailySlotKeys: new Set(['2026-11-16:CL000001']),
    priorityIndex: new Map(portfolio.map((client, index) => [client.code, index])),
  }));
  const finalCodes = [...existing, ...selected].map((client) => client.code);

  assert.equal(finalCodes.length, 40);
  assert.deepEqual(finalCodes.slice(0, existing.length), existing.map((client) => client.code));
  assert.equal(new Set(finalCodes).size, 40);
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

test('22 completed calls leave 18 pending slots to keep the day at 40 total', () => {
  const completed = clients(22);
  const existingSlots = clients(62).slice(22, 62).map((client) => ({ client }));
  const completedCodes = new Set(completed.map((client) => client.code));
  const pendingSlots = preserveCompletedDailySlots(existingSlots, {
    target: 40,
    dateKey: '2026-11-19',
    completedCodes,
    resolvedCodes: new Set(),
    completedDailySlotKeys: new Set(),
  });
  const finalCodes = [...completedCodes, ...pendingSlots.map((slot) => slot.client.code)];

  assert.equal(pendingSlots.length, 18);
  assert.equal(new Set(finalCodes).size, 40);
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

test('uses last-known eligibility for past dates instead of today freshness', () => {
  const slots = clients(3).map((client) => ({ client }));
  const historicalEligible = ['CL000001', 'CL000003'];
  const freshEligible = ['CL000001'];
  const yesterday = filterAgendaSlotsByPriorInvoice(slots, historicalEligible, {
    selectedMonthKey: '2026-11',
    currentMonthKey: '2026-11',
  });
  const tomorrow = filterAgendaSlotsByPriorInvoice(slots, freshEligible, {
    selectedMonthKey: '2026-11',
    currentMonthKey: '2026-11',
  });

  assert.deepEqual(yesterday.map((slot) => slot.client.code), ['CL000001', 'CL000003']);
  assert.deepEqual(tomorrow, [{ client: slots[0].client }]);
});

test('current and future agenda candidates use server-verified mora over stale portfolio values', () => {
  const clients = [
    { code: 'CURRENT-ONLY', daysArrears: 0 },
    { code: 'STALE-ZERO', daysArrears: 0 },
    { code: 'OVERDUE', daysArrears: 1 },
    { code: 'MORE-OVERDUE', daysArrears: 45 },
  ];

  assert.deepEqual(
    filterAgendaClientsByVerifiedMora(
      clients,
      {
        'STALE-ZERO': 31,
        OVERDUE: 0,
        'MORE-OVERDUE': 45,
      },
    ).map((client) => [client.code, client.daysArrears, client.moraRange]),
    [
      ['STALE-ZERO', 31, '31-60'],
      ['MORE-OVERDUE', 45, '31-60'],
    ],
  );
});

test('current and future candidates require a prior-month invoice as well as positive verified mora', () => {
  const portfolio = [
    { code: 'OLD-INVOICE', daysArrears: 0 },
    { code: 'CURRENT-ONLY', daysArrears: 60 },
    { code: 'UNVERIFIED', daysArrears: 45 },
  ];
  const verifiedMoraByCode = {
    'OLD-INVOICE': 31,
    'CURRENT-ONLY': 60,
    UNVERIFIED: 45,
  };

  const currentMonth = filterAgendaClientsByInvoiceEligibility(
    portfolio,
    ['OLD-INVOICE'],
    verifiedMoraByCode,
    { selectedMonthKey: '2026-11', currentMonthKey: '2026-11' },
  );
  const nextMonth = filterAgendaClientsByInvoiceEligibility(
    portfolio,
    ['OLD-INVOICE'],
    verifiedMoraByCode,
    { selectedMonthKey: '2026-12', currentMonthKey: '2026-11' },
  );
  const historicalMonth = filterAgendaClientsByInvoiceEligibility(
    portfolio,
    [],
    {},
    { selectedMonthKey: '2026-10', currentMonthKey: '2026-11' },
  );

  assert.deepEqual(currentMonth.map((client) => client.code), ['OLD-INVOICE']);
  assert.deepEqual(nextMonth.map((client) => client.code), ['OLD-INVOICE']);
  assert.deepEqual(historicalMonth, portfolio);
});

test('routine current-invoice-only clients stay out while explicit and overdue follow-ups remain', () => {
  const codes = ['OLD-INVOICE', 'CURRENT-ONLY', 'PROMISE-DUE', 'RESCHEDULE-DUE'];
  const kept = keepEligibleAgendaFollowUps(
    codes,
    ['OLD-INVOICE'],
    new Map([['RESCHEDULE-DUE', '2026-11-24']]),
    ['PROMISE-DUE'],
    '2026-11-24',
  );

  assert.deepEqual(kept, ['OLD-INVOICE', 'PROMISE-DUE', 'RESCHEDULE-DUE']);
});

test('server-verified clients fill the 40-slot target even when portfolio mora is stale', () => {
  const portfolio = clients(50).map((client) => ({
    ...client,
    daysArrears: 0,
    moraRange: '0-30' as const,
  }));
  const verifiedMoraByCode = Object.fromEntries(
    portfolio.map((client, index) => [client.code, index + 1]),
  );
  const eligible = filterAgendaClientsByVerifiedMora(portfolio, verifiedMoraByCode);
  const selected = selectDailyAgendaRefillCandidates(eligible, options({
    priorityIndex: new Map(eligible.map((client, index) => [client.code, index])),
  }));

  assert.equal(selected.length, 40);
  assert.ok(selected.every((client) => client.daysArrears > 0));
  assert.equal(new Set(selected.map((client) => client.code)).size, 40);
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

test('holds a client until the day after a promise and releases only verified unpaid promises', () => {
  const promise = {
    clientCode: 'CL-PROMISE',
    agreement: 'Promesa de Pago',
    assignedDate: '2026-11-18',
    deadlineDate: '2026-11-20',
    timestamp: '2026-11-18T16:00:00.000Z',
    countable: true,
  };

  assert.deepEqual([...buildPromiseUnavailableCodes([promise], '2026-11-18')], []);
  assert.deepEqual([...buildPromiseUnavailableCodes([promise], '2026-11-19')], ['CL-PROMISE']);
  assert.deepEqual([...buildPromiseUnavailableCodes([promise], '2026-11-20')], ['CL-PROMISE']);
  assert.deepEqual([...buildPromiseUnavailableCodes([promise], '2026-11-21')], ['CL-PROMISE']);
  assert.deepEqual([...buildPromiseUnavailableCodes([{
    ...promise,
    promiseVerificationStatus: 'unpaid',
  }], '2026-11-21')], []);
  assert.deepEqual([...buildPromiseUnavailableCodes([{
    ...promise,
    promiseVerificationStatus: 'paid',
  }], '2026-11-21')], ['CL-PROMISE']);
});

test('a later non-promise management replaces the prior promise hold', () => {
  const records = [
    {
      clientCode: 'CL-PROMISE',
      agreement: 'Promesa de Pago',
      assignedDate: '2026-11-18',
      deadlineDate: '2026-11-20',
      timestamp: '2026-11-18T16:00:00.000Z',
      countable: true,
    },
    {
      clientCode: 'CL-PROMISE',
      agreement: 'Sin Acuerdo',
      assignedDate: '2026-11-19',
      timestamp: '2026-11-19T16:00:00.000Z',
      countable: true,
    },
  ];

  assert.deepEqual([...buildPromiseUnavailableCodes(records, '2026-11-20')], []);
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
