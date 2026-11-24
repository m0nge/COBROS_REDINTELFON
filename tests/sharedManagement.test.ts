import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent, Client } from '../src/types.ts';
import { buildSharedAgentAuditRecords } from '../src/utils/sharedManagement.ts';

const agent = (id: string): Agent => ({
  id,
  name: `Agent ${id}`,
  email: `${id}@example.invalid`,
  phone: '',
  pbxExtension: '',
  country: 'SV',
  role: 'agente',
  status: 'activo',
  avatarUrl: '',
  effectivenessRate: null,
  assignedCount: 1,
  managedCount: 0,
  pendingCount: 1,
});

const client: Client = {
  code: 'CL000001',
  name: 'Cliente compartido',
  country: 'SV',
  totalDebt: 100,
  daysArrears: 15,
  moraRange: '0-30',
  state: 'Pendiente',
  priority: 'Normal',
  invoiceDate: '',
  dueDate: '',
  isSharedAssignment: true,
  sharedManagementHistory: [
    {
      id: 'latest',
      at: '2026-11-25T16:00:00.000Z',
      agentId: 'agent-1',
      scheduledForDate: '2026-11-25',
      agreement: 'Sin Acuerdo',
      state: 'Contactado',
    },
    {
      id: 'same-day-older',
      at: '2026-11-25T15:00:00.000Z',
      agentId: 'agent-2',
      scheduledForDate: '2026-11-25',
      agreement: 'Sin Acuerdo',
      state: 'Contactado',
    },
  ],
};

test('shared management contributes the same daily completion to both assigned agents', () => {
  const firstAgentRecords = buildSharedAgentAuditRecords([client], agent('agent-1'));
  const secondAgentRecords = buildSharedAgentAuditRecords([client], agent('agent-2'));

  assert.equal(firstAgentRecords.length, 1);
  assert.equal(secondAgentRecords.length, 1);
  assert.equal(firstAgentRecords[0].scheduledForDate, '2026-11-25');
  assert.equal(secondAgentRecords[0].scheduledForDate, '2026-11-25');
  assert.equal(firstAgentRecords[0].agentId, 'agent-1');
  assert.equal(secondAgentRecords[0].agentId, 'agent-2');
  assert.equal(firstAgentRecords[0].contactSuccess, '');
  assert.equal(secondAgentRecords[0].contactSuccess, '');
});

test('shared history is not added to non-shared or other-country portfolios', () => {
  assert.deepEqual(buildSharedAgentAuditRecords([{
    ...client,
    isSharedAssignment: false,
  }], agent('agent-1')), []);
  assert.deepEqual(buildSharedAgentAuditRecords([{
    ...client,
    country: 'GT',
  }], agent('agent-1')), []);
});
