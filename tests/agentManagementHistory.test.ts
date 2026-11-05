import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientManagementHistoryItem, GestionAuditRecord } from '../src/types';
import { mergeAgentManagementHistory } from '../src/utils/agentManagementHistory';

const localHistory: ClientManagementHistoryItem = {
  id: 'hist-submission-1',
  timestamp: '2026-11-04T14:00:00.000Z',
  date: '04 nov 2026',
  scheduledForDate: '2026-11-04',
  time: '08:00:00 a. m.',
  channel: 'Email',
  contactSuccess: 'Sí',
  agreement: 'Sin Acuerdo',
  observations: 'Cache local',
  agentName: 'MDCASTILLO',
  dynamicValues: { localAuditId: 'submission-1', scheduledForDate: '2026-11-04' },
};

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

test('hydrates the client history from persisted records and prefers server details by localAuditId', () => {
  const history = mergeAgentManagementHistory(
    [localHistory],
    [persistedRecord],
    'SV',
    'cl003263',
    '2026-11',
  );

  assert.equal(history.length, 1);
  assert.equal(history[0].id, localHistory.id);
  assert.equal(history[0].agreement, 'Promesa de Pago');
  assert.equal(history[0].observations, 'Confirmó el compromiso por correo.');
  assert.equal(history[0].agentName, 'Mirna Castillo');
  assert.equal(history[0].timestamp, persistedRecord.timestamp);
});

test('does not leak another country, client, or month into the client modal history', () => {
  const history = mergeAgentManagementHistory(
    [],
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

  assert.deepEqual(history.map((entry) => entry.id), ['submission-1']);
});

test('does not present local-only history as confirmed server history', () => {
  const history = mergeAgentManagementHistory(
    [{ ...localHistory, id: 'legacy', dynamicValues: undefined }],
    [],
    'SV',
    'CL003263',
    '2026-11',
  );

  assert.equal(history.length, 0);
});
