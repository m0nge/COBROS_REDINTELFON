import test from 'node:test';
import assert from 'node:assert/strict';
import { sumMonthlyRecoveredAmount } from '../src/utils/monthlyRecovery';

test('includes a directly collected payment even when no promise amount exists', () => {
  const rows = [
    { estado: 'Resuelto', monto_recuperado: '875.50' },
    { estado: 'Resuelto', monto_recuperado: 24.5 },
  ];

  assert.equal(sumMonthlyRecoveredAmount(rows), 900);
});

test('ignores pending, invalid, and negative monthly recovery amounts', () => {
  const rows = [
    { estado: 'Pendiente', monto_recuperado: 400 },
    { estado: 'Resuelto', monto_recuperado: 'not-a-number' },
    { estado: 'Resuelto', monto_recuperado: -20 },
    { estado: 'Resuelto', monto_recuperado: null },
  ];

  assert.equal(sumMonthlyRecoveredAmount(rows), 0);
});
