import assert from 'node:assert/strict';
import test from 'node:test';
import type { GestionAuditRecord } from '../src/types.ts';
import { sortClientManagementHistory } from '../src/utils/clientManagementHistory.ts';

function makeRecord(overrides: Partial<GestionAuditRecord> = {}): GestionAuditRecord {
  return {
    id: 'record-1',
    timestamp: '2026-11-04T14:00:00.000Z',
    date: '04 nov 2026',
    time: '08:00:00 a. m.',
    agentId: 'agent-1',
    agentName: 'Agente Uno',
    clientCode: 'CL003263',
    clientName: 'Cliente Uno',
    country: 'SV',
    channel: 'Llamada',
    contactSuccess: 'Sí',
    agreement: 'Promesa de Pago',
    observations: 'Registro persistido',
    ...overrides,
  };
}

test('returns every persisted management for the selected client across dates, newest first', () => {
  const records = sortClientManagementHistory([
    makeRecord({ id: 'older', timestamp: '2026-10-03T14:00:00.000Z' }),
    makeRecord({ id: 'latest', timestamp: '2026-11-04T14:00:00.000Z' }),
    makeRecord({ id: 'other-client', clientCode: 'CL000001' }),
    makeRecord({ id: 'other-country', country: 'GT' }),
  ], 'SV', 'cl003263');

  assert.deepEqual(records.map((record) => record.id), ['latest', 'older']);
});

test('does not deduplicate separate database rows for the same client', () => {
  const records = sortClientManagementHistory([
    makeRecord({ id: 'row-a', dynamicValues: { localAuditId: 'same-retry-id' } }),
    makeRecord({ id: 'row-b', dynamicValues: { localAuditId: 'same-retry-id' } }),
  ], 'SV', 'CL003263');

  assert.deepEqual(records.map((record) => record.id), ['row-b', 'row-a']);
});
