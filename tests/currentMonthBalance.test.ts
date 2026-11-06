import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentMonthBalanceCleared } from '../src/utils/currentMonthBalance.ts';

test('clears the month only when SAN verifies a zero pending amount', () => {
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: true,
    invoiceBalancesComplete: true,
    summary: { mesPendientesMonto: 0 },
  }), true);
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: true,
    invoiceBalancesComplete: true,
    summary: { mesPendientesMonto: 0.01 },
  }), true);
});

test('does not clear the month for pending balances or incomplete SAN data', () => {
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: true,
    invoiceBalancesComplete: true,
    summary: { mesPendientesMonto: 10 },
  }), false);
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: true,
    invoiceBalancesComplete: false,
    summary: { mesPendientesMonto: 0 },
  }), false);
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: false,
    invoiceBalancesComplete: true,
    summary: { mesPendientesMonto: 0 },
  }), false);
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: true,
    invoiceBalancesComplete: true,
    summary: { mesPendientesMonto: 'unknown' },
  }), false);
  assert.equal(isCurrentMonthBalanceCleared({
    invoiceDataAvailable: true,
    invoiceBalancesComplete: true,
    summary: { mesPendientesMonto: null },
  }), false);
});
