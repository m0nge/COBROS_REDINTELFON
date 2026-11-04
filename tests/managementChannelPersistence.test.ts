import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateManagement } from '../api/evaluar-gestion.ts';
import { resolvePersistedChannel } from '../server/routes/syncLocalAudit.ts';

test('persists WhatsApp as the channel for a successful contact even if the record channel is stale', () => {
  const channel = resolvePersistedChannel('Llamada', 'Sí', {
    tipo_gestion: 'WhatsApp',
    contactChannel: 'WhatsApp',
  });

  assert.equal(channel, 'WhatsApp');
});

test('accepts the same promise-contact fields for WhatsApp as for a phone call', () => {
  const result = evaluateManagement({
    successfulContact: 'Sí',
    agreement: 'Promesa de Pago',
    managementType: 'WhatsApp',
    contactChannel: 'WhatsApp',
    contactName: 'María López',
    contactPhone: '77778888',
    deadlineDate: '2026-11-20',
    committedAmount: 125,
    agreementDetails: 'Se confirmó una promesa de pago por WhatsApp.',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.score, 100);
});

test('still requires a valid contact phone for a WhatsApp promise', () => {
  const result = evaluateManagement({
    successfulContact: 'Sí',
    agreement: 'Promesa de Pago',
    managementType: 'WhatsApp',
    contactChannel: 'WhatsApp',
    contactName: 'María López',
    contactPhone: '',
    deadlineDate: '2026-11-20',
    committedAmount: 125,
  });

  assert.equal(result.isValid, false);
  assert.ok(result.reasons.some((reason) => reason.includes('teléfono')));
});
