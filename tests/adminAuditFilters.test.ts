import assert from 'node:assert/strict';
import test from 'node:test';
import type { GestionAuditRecord } from '../src/types.ts';
import { filterAgentAuditRecordsForSelectedDay } from '../src/utils/adminAuditFilters.ts';

function makeRecord(overrides: Partial<GestionAuditRecord> = {}): GestionAuditRecord {
  return {
    id: 'record-1',
    timestamp: '',
    date: '2026-11-03',
    time: '09:00:00 AM',
    agentId: 'agent-1',
    agentName: 'Agente',
    clientCode: 'CL000001',
    clientName: 'Cliente Uno',
    country: 'SV',
    channel: 'Llamada',
    contactSuccess: 'Sí',
    agreement: 'Sin acuerdo',
    observations: 'Se realizó seguimiento',
    ...overrides,
  };
}

test('filters the admin agent audit to the exact date selected in the daily view', () => {
  const previousDayLateRecord = makeRecord({
    id: 'late-local-record',
    date: '2026-11-04',
    timestamp: '2026-11-04T05:30:00.000Z',
  });
  const nextDayRecord = makeRecord({
    id: 'next-day-record',
    date: '2026-11-04',
    timestamp: '2026-11-04T06:00:00.000Z',
  });
  const anotherDayRecord = makeRecord({
    id: 'another-day-record',
    date: '2026-11-02',
  });

  const records = filterAgentAuditRecordsForSelectedDay(
    [previousDayLateRecord, nextDayRecord, anotherDayRecord],
    '2026-11-03',
  );

  assert.deepEqual(records.map((record) => record.id), ['late-local-record']);
});

test('keeps channel and search filters within the selected day', () => {
  const records = [
    makeRecord({ id: 'call-match', channel: 'Llamada', clientCode: 'CL-ALFA' }),
    makeRecord({ id: 'whatsapp-match', channel: 'WhatsApp', clientCode: 'CL-ALFA' }),
    makeRecord({ id: 'other-client', channel: 'Llamada', clientCode: 'CL-BETA' }),
    makeRecord({ id: 'yesterday', date: '2026-11-02', channel: 'Llamada', clientCode: 'CL-ALFA' }),
  ];

  const filtered = filterAgentAuditRecordsForSelectedDay(
    records,
    '2026-11-03',
    'Llamada',
    'alfa',
  );

  assert.deepEqual(filtered.map((record) => record.id), ['call-match']);
});
