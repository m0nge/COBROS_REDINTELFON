import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreviousInvoiceMonth,
  getSanInvoiceMonthsBeforeMonth,
  hasUnpaidSanInvoiceIssuedInMonth,
  getPromiseReconciliationMonth,
  summarizeSanPortfolioInvoices,
  verifySanInvoicesForMonth,
} from '../server/paymentReconciliation.ts';

test('moves invoice agenda months across year boundaries', () => {
  assert.equal(getPreviousInvoiceMonth('2026-11'), '2026-10');
  assert.equal(getPreviousInvoiceMonth('2027-01'), '2026-12');
  assert.equal(getPreviousInvoiceMonth('bad-month'), '');
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
