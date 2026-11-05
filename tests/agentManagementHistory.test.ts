import assert from 'node:assert/strict';
import test from 'node:test';
import type { GestionAuditRecord } from '../src/types';
import { mergeAgentManagementHistory } from '../src/utils/agentManagementHistory';

const persistedRecord: GestionAuditRecord = {
  id: 'managed-summary-database-row-agent',
  timestamp: '2026-11-04T14:00:00.000Z',
  date: '04 nov 2026',
  scheduledForDate: '2026-11-04',
  time: '08:00:00 a. m.',
  agentId: 'agent-1',
  agentName: 'Mirna Castillo',
  clientCode: 'CL003263',
  clientName: 'CORTE DE CUENTAS DE LA REPUBLICA',
  country: 'SV',
  channel: 'Email',
  contactSuccess: 'Sí',
  agreement: 'Promesa de Pago',
  observations: 'Confirmó el compromiso por correo.',
  aiVerdict: 'Válida',
  dynamicValues: {
    localAuditId: 'submission-1',
    scheduledForDate: '2026-11-04',
  },
  status: 'Contactado',
};

test('builds the client history from persisted records and retains the database id', () => {
  const history = mergeAgentManagementHistory(
    [persistedRecord],
    'SV',
    'cl003263',
    '2026-11',
  );

  assert.equal(history.length, 1);
  assert.equal(history[0].id, persistedRecord.id);
  assert.equal(history[0].agreement, 'Promesa de Pago');
  assert.equal(history[0].observations, 'Confirmó el compromiso por correo.');
  assert.equal(history[0].agentName, 'Mirna Castillo');
  assert.equal(history[0].timestamp, persistedRecord.timestamp);
});

test('does not leak another country, client, or month into the client modal history', () => {
  const history = mergeAgentManagementHistory(
    [
      persistedRecord,
      { ...persistedRecord, id: 'other-client', clientCode: 'CL000001' },
      { ...persistedRecord, id: 'other-country', country: 'GT' },
      {
        ...persistedRecord,
        id: 'last-month',
        timestamp: '2026-10-31T23:59:00.000Z',
        date: '31 oct 2026',
        scheduledForDate: '2026-10-31',
        dynamicValues: { localAuditId: 'october-record', scheduledForDate: '2026-10-31' },
      },
    ],
    'SV',
    'CL003263',
    '2026-11',
  );

  assert.deepEqual(history.map((entry) => entry.id), [persistedRecord.id]);
});

test('preserves distinct server rows even when they share the same local retry id', () => {
  const secondRecord: GestionAuditRecord = {
    ...persistedRecord,
    id: 'another-database-row',
    timestamp: '2026-11-04T15:00:00.000Z',
    observations: 'Segundo registro persistido.',
  };
  const history = mergeAgentManagementHistory(
    [persistedRecord, secondRecord],
    'SV',
    'CL003263',
    '2026-11',
  );

  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.id), ['another-database-row', persistedRecord.id]);
});
