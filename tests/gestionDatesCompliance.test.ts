import assert from 'node:assert/strict';
import test from 'node:test';
import type { GestionAuditRecord } from '../src/types.ts';
import { isComplianceEligibleManagement } from '../src/utils/gestionDates.ts';

const baseRecord: GestionAuditRecord = {
  id: 'record-1',
  timestamp: '2026-11-16T16:00:00.000Z',
  date: '2026-11-16',
  time: '10:00',
  agentId: 'agent-1',
  agentName: 'Agente',
  clientCode: 'CL000001',
  clientName: 'Cliente',
  country: 'SV',
  channel: 'WhatsApp',
  contactSuccess: 'Sí',
  agreement: 'Promesa de Pago',
  committedAmount: 100,
  deadlineDate: '2026-11-20',
  observations: '',
  aiVerdict: 'Válida',
  status: 'Contactado',
};

test('only valid promise-of-payment records count toward compliance', () => {
  assert.equal(isComplianceEligibleManagement(baseRecord), true);
  assert.equal(isComplianceEligibleManagement({
    ...baseRecord,
    agreement: 'Negociación de Cuotas',
  }), false);
  assert.equal(isComplianceEligibleManagement({
    ...baseRecord,
    agreement: 'Sin Acuerdo',
    contactSuccess: 'No',
    status: 'Reprogramado',
    dynamicValues: { rescheduleDate: '2026-11-20' },
  }), false);
  assert.equal(isComplianceEligibleManagement({
    ...baseRecord,
    aiVerdict: 'Inválida',
  }), false);
});

test('a verified paid record counts only with its payment date and receipt', () => {
  const payment: GestionAuditRecord = {
    ...baseRecord,
    agreement: 'Pago realizado',
    committedAmount: undefined,
    deadlineDate: undefined,
    status: 'Resuelto',
    dynamicValues: {
      paymentOutcome: 'payment_received',
      paymentDate: '2026-11-16',
      paymentEvidencePath: 'receipts/payment.png',
    },
  };
  assert.equal(isComplianceEligibleManagement(payment), true);
  assert.equal(isComplianceEligibleManagement({
    ...payment,
    dynamicValues: { paymentOutcome: 'payment_received', paymentDate: '2026-11-16' },
  }), false);
});
