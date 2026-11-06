import type { Agent, GestionAuditRecord } from '../types';
import { getManagementScheduledDateKey, isCountableManagement } from './gestionDates';

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function getUniqueDailyManagementKeys(
  records: GestionAuditRecord[],
  dateKey: string,
  activeAgents: Agent[],
): Set<string> {
  const eligibleAgents = activeAgents.filter((agent) => agent.status === 'activo');
  const agentIds = new Set(eligibleAgents.map((agent) => agent.id));
  const agentIdsByName = new Map(
    eligibleAgents.map((agent) => [`${agent.country}:${normalizeName(agent.name)}`, agent.id]),
  );

  return new Set(records.flatMap((record) => {
    if (
      !isCountableManagement(record)
      || getManagementScheduledDateKey(record) !== dateKey
      || !record.clientCode.trim()
    ) return [];

    const agentId = record.agentId && agentIds.has(record.agentId)
      ? record.agentId
      : agentIdsByName.get(`${record.country}:${normalizeName(record.agentName || '')}`);
    if (!agentId) return [];

    const clientCode = record.clientCode.trim().toLocaleUpperCase();
    return [`${agentId}:${record.country}:${clientCode}`];
  }));
}
