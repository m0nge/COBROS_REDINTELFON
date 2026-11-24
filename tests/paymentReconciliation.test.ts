import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreviousInvoiceMonth,
  getSanInvoiceMonthsBeforeMonth,
  hasUnpaidSanInvoiceIssuedInMonth,
  getPromiseReconciliationMonth,
  isPromiseVerificationDue,
  groupPromises,
  summarizeSanPortfolioInvoices,
  verifySanPromiseInvoicesForMonth,
  verifySanInvoicesForMonth,
  runPaymentReconciliation,
} from '../server/paymentReconciliation.ts';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null as Record<string, any> | null,
    setHeader() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: Record<string, any>) {
      this.body = body;
      return this;
    },
  };
}

test('moves invoice agenda months across year boundaries', () => {
  assert.equal(getPreviousInvoiceMonth('2026-11'), '2026-10');
  assert.equal(getPreviousInvoiceMonth('2027-01'), '2026-12');
  assert.equal(getPreviousInvoiceMonth('bad-month'), '');
});

test('verifies a payment promise only on the day after its due date', () => {
  assert.equal(isPromiseVerificationDue('2026-11-20', '2026-11-20'), false);
  assert.equal(isPromiseVerificationDue('2026-11-20', '2026-11-21'), true);
  assert.equal(isPromiseVerificationDue('invalid', '2026-11-21'), false);
});

test('requires an unpaid non-void invoice in a prior month', () => {
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-10-30', estado: 'PENDIENTE', valordoc: '100.00' },
    { fechaEmision: '2026-11-02', estado: 'PAGADO', valordoc: '50.00' },
  ], '2026-10'), true);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-11-02', estado: 'PENDIENTE', valordoc: '50.00' },
  ], '2026-10'), false);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-10-02', estado: 'ANULADA', valordoc: '50.00' },
  ], '2026-10'), false);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([], '2026-10'), false);
});

test('excludes clients whose only outstanding invoice is from the current agenda month', () => {
  const invoices = [
    { fechaEmision: '2026-10-30', estado: 'PAGADO', valordoc: '100.00' },
    { fechaEmision: '2026-11-02', estado: 'PENDIENTE', valordoc: '50.00' },
  ];
  const isEligibleForAgendaMonth = (agendaMonth: string) =>
    getSanInvoiceMonthsBeforeMonth(invoices, agendaMonth).some((invoiceMonth) =>
      hasUnpaidSanInvoiceIssuedInMonth(invoices, invoiceMonth) === true
    );

  assert.equal(hasUnpaidSanInvoiceIssuedInMonth(invoices, '2026-10'), false);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth(invoices, '2026-11'), true);
  assert.equal(isEligibleForAgendaMonth('2026-11'), false);
  assert.equal(isEligibleForAgendaMonth('2026-12'), true);
});

test('counts a prior-month partially paid invoice only while a balance remains', () => {
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-10-30', estado: 'PAGO PARCIAL', valordoc: '100.00', pago: '20.00' },
  ], '2026-10'), true);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-10-30', estado: 'PAGO PARCIAL', valordoc: '100.00', pago: '99.98' },
  ], '2026-10'), true);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-10-30', estado: 'PAGO PARCIAL', valordoc: '100.00', pago: '100.00' },
  ], '2026-10'), false);
});

test('counts any non-void invoice from any month before the agenda month', () => {
  assert.deepEqual(getSanInvoiceMonthsBeforeMonth([
    { fechaEmision: '2026-08-30', estado: 'PENDIENTE' },
    { fechaEmision: '2026-10-02', estado: 'PAGADO' },
    { fechaEmision: '2026-11-02', estado: 'PENDIENTE' },
    { fechaEmision: '2026-07-10', estado: 'ANULADA' },
  ], '2026-11'), ['2026-08', '2026-10']);
  assert.deepEqual(getSanInvoiceMonthsBeforeMonth([
    { fechaEmision: '2026-11-02', estado: 'PENDIENTE' },
  ], '2026-11'), []);
  assert.deepEqual(getSanInvoiceMonthsBeforeMonth([
    { fechaEmision: '2026-12-02', estado: 'PENDIENTE' },
  ], '2026-11'), []);
});

test('does not treat incomplete invoice dates or statuses as proof of eligibility', () => {
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { estado: 'PENDIENTE', valordoc: '50.00' },
  ], '2026-10'), null);
  assert.equal(hasUnpaidSanInvoiceIssuedInMonth([
    { fechaEmision: '2026-10-02', valordoc: '50.00' },
  ], '2026-10'), null);
});

test('uses the scheduled operational month before the created month for payment reconciliation', () => {
  assert.equal(getPromiseReconciliationMonth({
    created_at: '2026-11-03T15:18:00.000Z',
    valores_dinamicos: {
      scheduledForDate: '2026-10-31',
      periodMonth: '2026-11',
    },
  }), '2026-10');
});

test('uses the newest promise amount for a client and month instead of adding superseded promises', () => {
  const groups = groupPromises([
    {
      id: 'old',
      cliente_id: 'client-1',
      acuerdo: 'Promesa de Pago',
      monto_comprometido: 100,
      created_at: '2026-11-04T10:00:00.000Z',
      valores_dinamicos: { scheduledForDate: '2026-11-04' },
      clientes: { codigo: 'CL001', pais: 'SV' },
    },
    {
      id: 'new',
      cliente_id: 'client-1',
      acuerdo: 'Promesa de Pago',
      monto_comprometido: 250,
      created_at: '2026-11-05T10:00:00.000Z',
      valores_dinamicos: { scheduledForDate: '2026-11-05' },
      clientes: { codigo: 'CL001', pais: 'SV' },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].periods.get('2026-11'), 250);
});

test('reconciles only invoices issued in the requested month', () => {
  const result = verifySanInvoicesForMonth([
    { fechaEmision: '2026-11-02', estado: 'PAGADO', valordoc: '$1,234.56' },
    { fechaEmision: '2026-10-30', estado: 'PENDIENTE', valordoc: '250.00' },
  ], '2026-11');

  assert.deepEqual(result, { status: 'paid', amount: 1234.56 });
});

test('treats a fully covered partial-payment invoice as paid', () => {
  const result = verifySanInvoicesForMonth([
    { fechaEmision: '2026-11-02', estado: 'PAGO PARCIAL', valordoc: '100.00', pago: '99.99' },
  ], '2026-11');

  assert.deepEqual(result, { status: 'paid', amount: 100 });
});

test('reports an outstanding current-month invoice as unpaid', () => {
  const result = verifySanInvoicesForMonth([
    { fechaEmision: '2026-11-02', estado: 'PENDIENTE', valordoc: '100.00' },
  ], '2026-11');

  assert.deepEqual(result, { status: 'unpaid', amount: 0 });
});

test('treats a pending current-month invoice with a zero balance as resolved', () => {
  const result = verifySanInvoicesForMonth([
    { fechaEmision: '2026-11-02', estado: 'PENDIENTE', valordoc: '0.00' },
  ], '2026-11');

  assert.deepEqual(result, { status: 'paid', amount: 0 });
});

test('ignores voided invoices and records a valid empty month as zero recovery', () => {
  const result = verifySanInvoicesForMonth([
    { fechaEmision: '2026-11-02', estado: 'ANULADA', valordoc: '100.00' },
  ], '2026-11');

  assert.deepEqual(result, { status: 'paid', amount: 0 });
  assert.deepEqual(verifySanInvoicesForMonth([], '2026-11'), { status: 'paid', amount: 0 });
});

test('does not mark an unknown SAN invoice status as paid', () => {
  const result = verifySanInvoicesForMonth([
    { fechaEmision: '2026-11-02', estado: 'EN PROCESO', valordoc: '100.00' },
  ], '2026-11');

  assert.deepEqual(result, { status: 'unknown', amount: 0 });
});

test('does not mark a promise unpaid for a current-month invoice due next month', () => {
  const invoices = [
    {
      fechaEmision: '2026-11-02',
      fechavence: '2026-12-05',
      estado: 'PENDIENTE',
      valordoc: '100.00',
    },
  ];

  assert.deepEqual(verifySanPromiseInvoicesForMonth(invoices, '2026-10', '2026-11-24'), {
    status: 'not_due',
    amount: 0,
  });
  assert.deepEqual(verifySanPromiseInvoicesForMonth(invoices, '2026-11', '2026-11-24'), {
    status: 'not_due',
    amount: 0,
    availableOn: '2026-12-06',
  });
});

test('marks an unpaid invoice in the collected month overdue only after its SAN due date', () => {
  const invoice = {
    fechaEmision: '2026-10-02',
    fechavence: '2026-10-31',
    estado: 'PENDIENTE',
    valordoc: '100.00',
  };

  assert.deepEqual(verifySanPromiseInvoicesForMonth([invoice], '2026-10', '2026-10-31'), {
    status: 'unpaid',
    amount: 0,
  });
  assert.deepEqual(verifySanPromiseInvoicesForMonth([invoice], '2026-10', '2026-10-30'), {
    status: 'not_due',
    amount: 0,
    availableOn: '2026-11-01',
  });
});

test('keeps promise verification unknown when a pending invoice has no due date', () => {
  assert.deepEqual(verifySanPromiseInvoicesForMonth([{
    fechaEmision: '2026-10-02',
    estado: 'PENDIENTE',
    valordoc: '100.00',
  }], '2026-10', '2026-11-24'), {
    status: 'unknown',
    amount: 0,
  });
  assert.deepEqual(verifySanPromiseInvoicesForMonth([{
    fechaEmision: '2026-10-02',
    fechavence: '2026-02-31',
    estado: 'PENDIENTE',
    valordoc: '100.00',
  }], '2026-10', '2026-11-24'), {
    status: 'unknown',
    amount: 0,
  });
});

test('scheduled reconciliation does not mark a current-month invoice unpaid as a prior-month promise', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSanApiKey = process.env.SAN_API_KEY;
  const originalCronSecret = process.env.CRON_SECRET;
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const today = `${currentDate.find((part) => part.type === 'year')?.value}-${currentDate.find((part) => part.type === 'month')?.value}-${currentDate.find((part) => part.type === 'day')?.value}`;
  const month = today.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonth = `${new Date(Date.UTC(year, monthNumber, 1)).getUTCFullYear()}-${String(new Date(Date.UTC(year, monthNumber, 1)).getUTCMonth() + 1).padStart(2, '0')}`;
  const promiseDate = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const writes: URL[] = [];
  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  process.env.SAN_API_KEY = 'san-test-only';
  process.env.CRON_SECRET = 'cron-test-only';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (String(init?.method || 'GET').toUpperCase() !== 'GET') writes.push(url);
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) {
      return Response.json([{
        id: 'promise-1',
        cliente_id: 'client-1',
        acuerdo: 'Promesa de Pago',
        monto_comprometido: '150.00',
        fecha_limite_pago: promiseDate,
        created_at: new Date(`${today}T12:00:00-06:00`).toISOString(),
        valores_dinamicos: {
          scheduledForDate: `${month}-01`,
          periodMonth: month,
        },
        clientes: { codigo: 'CL001', pais: 'SV' },
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/estado_cartera_mensual')) return Response.json([]);
    if (url.hostname === 'san.red.com.sv') {
      return Response.json([{
        fechaEmision: `${month}-01`,
        fechavence: `${nextMonth}-05`,
        estado: 'PENDIENTE',
        valordoc: '150.00',
      }]);
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;
  const response = responseRecorder();

  try {
    await runPaymentReconciliation({
      method: 'GET',
      headers: { authorization: 'Bearer cron-test-only' },
      query: {},
      url: '/api/reconcile',
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.notDue, 1);
    assert.equal(response.body?.notFullyPaid, 0);
    assert.deepEqual(writes, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    if (originalSanApiKey === undefined) delete process.env.SAN_API_KEY;
    else process.env.SAN_API_KEY = originalSanApiKey;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  }
});

test('derives total debt and mora from SAN invoice due dates', () => {
  assert.deepEqual(summarizeSanPortfolioInvoices([
    {
      fechaEmision: '2026-11-01',
      fechavence: '2026-10-20',
      estado: 'PENDIENTE',
      valordoc: '100.00',
    },
    {
      fechaEmision: '2026-11-02',
      fechavence: '2026-11-20',
      estado: 'PAGO PARCIAL',
      valordoc: '60.00',
      pago: '10.00',
    },
    {
      fechaEmision: '2026-10-31',
      fechavence: '2026-10-01',
      estado: 'PAGADO',
      valordoc: '50.00',
    },
  ], '2026-11-11'), {
    totalDebt: 150,
    daysArrears: 22,
    moraRange: '0-30',
  });
});

test('does not publish a SAN mora snapshot when an unpaid invoice has no due date', () => {
  assert.equal(summarizeSanPortfolioInvoices([
    { estado: 'PENDIENTE', valordoc: '100.00' },
  ], '2026-11-11'), null);
});
