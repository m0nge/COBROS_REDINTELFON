import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPromiseReconciliationMonth,
  summarizeSanPortfolioInvoices,
  verifySanInvoicesForMonth,
} from '../server/paymentReconciliation.ts';

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
