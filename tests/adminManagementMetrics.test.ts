import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent, GestionAuditRecord } from '../src/types.ts';
import { getUniqueDailyManagementKeys } from '../src/utils/adminManagementMetrics.ts';

const agents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Mirna Castillo',
    email: 'mirna@example.com',
    phone: '',
    pbxExtension: '',
    country: 'SV',
    role: 'agente',
    status: 'activo',
    avatarUrl: '',
    effectivenessRate: null,
    assignedCount: 0,
    managedCount: 0,
    pendingCount: 0,
  },
  {
    id: 'agent-2',
    name: 'Karla Herrera',
    email: 'karla@example.com',
    phone: '',
    pbxExtension: '',
    country: 'SV',
    role: 'agente',
    status: 'activo',
    avatarUrl: '',
    effectivenessRate: null,
    assignedCount: 0,
    managedCount: 0,
    pendingCount: 0,
  },
  {
    id: 'inactive-agent',
    name: 'Agente Inactivo',
    email: 'inactive@example.com',
    phone: '',
    pbxExtension: '',
    country: 'SV',
    role: 'agente',
    status: 'inactivo',
    avatarUrl: '',
    effectivenessRate: null,
    assignedCount: 0,
    managedCount: 0,
    pendingCount: 0,
  },
];

function makeRecord(overrides: Partial<GestionAuditRecord> = {}): GestionAuditRecord {
  return {
    id: 'record-1',
    timestamp: '2026-11-06T05:30:00.000Z',
    date: '05 nov 2026',
    time: '11:30:00 PM',
    agentId: 'agent-1',
    agentName: 'Mirna Castillo',
    clientCode: 'CL000001',
    clientName: 'Cliente Uno',
    country: 'SV',
    channel: 'Llamada',
    contactSuccess: 'Sí',
    agreement: 'Sin acuerdo',
    aiVerdict: 'Válida',
    observations: '',
    ...overrides,
  };
}

test('counts a valid management on its agenda date, not a UTC-shifted creation date', () => {
  const record = makeRecord({ scheduledForDate: '2026-11-06' });

  assert.equal(getUniqueDailyManagementKeys([record], '2026-11-06', agents).size, 1);
  assert.equal(getUniqueDailyManagementKeys([record], '2026-11-05', agents).size, 0);
});

test('counts one daily client per active agent and excludes invalid or inactive records', () => {
  const records = [
    makeRecord({ id: 'first', scheduledForDate: '2026-11-06' }),
    makeRecord({ id: 'duplicate', clientCode: ' cl000001 ', scheduledForDate: '2026-11-06' }),
    makeRecord({
      id: 'second-agent',
      agentId: 'agent-2',
      agentName: 'Karla Herrera',
      scheduledForDate: '2026-11-06',
    }),
    makeRecord({
      id: 'inactive-agent',
      agentId: 'inactive-agent',
      agentName: 'Agente Inactivo',
      scheduledForDate: '2026-11-06',
    }),
    makeRecord({
      id: 'invalid',
      clientCode: 'CL000002',
      aiVerdict: 'Inválida',
      scheduledForDate: '2026-11-06',
    }),
    makeRecord({
      id: 'another-day',
      clientCode: 'CL000003',
      scheduledForDate: '2026-11-07',
    }),
  ];

  assert.equal(getUniqueDailyManagementKeys(records, '2026-11-06', agents).size, 2);
});

test('resolves an active agent by name when older rows have no agent id', () => {
  const record = makeRecord({
    agentId: '',
    scheduledForDate: '2026-11-06',
  });

  assert.equal(getUniqueDailyManagementKeys([record], '2026-11-06', agents).size, 1);
});
