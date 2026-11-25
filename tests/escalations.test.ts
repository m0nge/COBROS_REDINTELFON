import assert from 'node:assert/strict';
import test from 'node:test';
import { getEscalationFollowUp } from '../src/utils/escalations.ts';

const base = {
  id: 'm1',
  createdAt: '2026-11-25T15:00:00.000Z',
  managedBy: 'Admin',
  channel: 'Llamada',
  contactSuccess: 'Si',
  agreement: 'Promesa de Pago',
  promiseDate: '2026-11-27',
  committedAmount: 50,
  observations: '',
  promiseVerificationStatus: '',
  promiseVerifiedAt: '',
};

test('an escalated promise becomes reviewable the day after the promised date', () => {
  assert.deepEqual(getEscalationFollowUp([base], '2026-11-27'), {
    promiseDate: '2026-11-27', reviewFrom: '2026-11-28', due: false, status: 'pending',
  });
  assert.equal(getEscalationFollowUp([base], '2026-11-28')?.due, true);
  assert.equal(getEscalationFollowUp([{ ...base, promiseVerificationStatus: 'paid' }], '2026-11-30')?.status, 'paid');
});

test('only the latest admin management decides the follow-up', () => {
  const later = { ...base, id: 'm2', createdAt: '2026-11-26T15:00:00.000Z', agreement: 'Sin Acuerdo', promiseDate: '' };
  assert.equal(getEscalationFollowUp([base, later], '2026-11-30'), null);
  assert.equal(getEscalationFollowUp([], '2026-11-30'), null);
});
