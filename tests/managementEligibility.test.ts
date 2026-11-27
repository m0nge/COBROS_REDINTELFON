import assert from 'node:assert/strict';
import test from 'node:test';
import { getGeneralPortfolioManagementBlockReason } from '../src/utils/managementEligibility.ts';

const today = '2026-11-27';

function promise(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-11-27T10:00:00-06:00',
    agreement: 'Promesa de Pago',
    contactSuccess: 'Sí',
    deadlineDate: '2026-11-28',
    committedAmount: 100,
    status: 'Contactado',
    dynamicValues: {},
    ...overrides,
  };
}

test('blocks a valid promise until the promised day has passed', () => {
  assert.equal(getGeneralPortfolioManagementBlockReason([promise()], today), 'promise_pending');
  assert.equal(
    getGeneralPortfolioManagementBlockReason([promise({ deadlineDate: today })], today),
    'promise_pending',
  );
});

test('allows an expired, invalid, or already paid promise', () => {
  assert.equal(
    getGeneralPortfolioManagementBlockReason([promise({ deadlineDate: '2026-11-26' })], today),
    null,
  );
  assert.equal(
    getGeneralPortfolioManagementBlockReason([promise({ aiVerdict: 'Inválida' })], today),
    null,
  );
  assert.equal(
    getGeneralPortfolioManagementBlockReason([promise({ dynamicValues: { promiseVerificationStatus: 'paid' } })], today),
    null,
  );
  assert.equal(
    getGeneralPortfolioManagementBlockReason([
      promise({ timestamp: '2026-11-26T10:00:00-06:00', deadlineDate: '2026-11-30' }),
      promise({
        timestamp: '2026-11-27T11:00:00-06:00',
        deadlineDate: '2026-11-30',
        dynamicValues: { promiseVerificationStatus: 'paid' },
      }),
    ], today),
    null,
  );
});

test('allows a promise after a verified payment and blocks a newer promise', () => {
  const payment = {
    timestamp: '2026-11-27T11:00:00-06:00',
    agreement: 'Pago realizado',
    status: 'Resuelto',
    dynamicValues: { paymentOutcome: 'payment_received', paymentDate: today, paymentEvidencePath: 'receipt.png' },
  };
  assert.equal(getGeneralPortfolioManagementBlockReason([promise(), payment], today), null);
  assert.equal(
    getGeneralPortfolioManagementBlockReason([promise(), payment, promise({
      timestamp: '2026-11-27T12:00:00-06:00',
    })], today),
    'promise_pending',
  );
});

test('blocks only a reschedule date that has not arrived', () => {
  const reschedule = {
    timestamp: '2026-11-27T10:00:00-06:00',
    status: 'Reprogramado',
    dynamicValues: { rescheduleDate: '2026-11-28' },
  };
  assert.equal(getGeneralPortfolioManagementBlockReason([reschedule], today), 'rescheduled_future');
  assert.equal(
    getGeneralPortfolioManagementBlockReason([{
      ...reschedule,
      dynamicValues: { rescheduleDate: today },
    }], today),
    null,
  );
  assert.equal(
    getGeneralPortfolioManagementBlockReason([reschedule, {
      timestamp: '2026-11-27T11:00:00-06:00',
      status: 'Contactado',
      dynamicValues: {},
    }], today),
    null,
  );
});
