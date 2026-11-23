import type { Agent, Client, GestionAuditRecord } from '../types';
import { getElSalvadorDateKey } from './gestionDates';

export function buildSharedAgentAuditRecords(
  clients: Client[],
  agent: Agent,
): GestionAuditRecord[] {
  const seenKeys = new Set<string>();
  return clients.flatMap((client) => {
    if (!client.isSharedAssignment || client.country !== agent.country) return [];
    return (client.sharedManagementHistory || []).flatMap((entry) => {
      const at = new Date(entry.at);
      if (Number.isNaN(at.getTime())) return [];
      const dateKey = String(entry.scheduledForDate || getElSalvadorDateKey(at)).slice(0, 10);
      const code = client.code.trim().toUpperCase();
      const key = `${client.country}:${code}:${dateKey}`;
      if (seenKeys.has(key)) return [];
      seenKeys.add(key);
      const isCurrentAgentRecord = entry.agentId === agent.id;
      return [{
        id: `shared-${entry.id}-${agent.id}`,
        timestamp: entry.at,
        date: new Intl.DateTimeFormat('es-SV', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'America/El_Salvador',
        }).format(at),
        scheduledForDate: entry.scheduledForDate || dateKey,
        time: new Intl.DateTimeFormat('es-SV', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'America/El_Salvador',
        }).format(at),
        agentId: agent.id,
        agentName: isCurrentAgentRecord ? 'Gestión compartida · tú' : 'Gestión compartida · compañera',
        clientCode: client.code,
        clientName: client.name,
        country: client.country,
        channel: entry.channel || 'Llamada',
        contactSuccess: entry.contactSuccess || 'Sí',
        agreement: entry.agreement || 'Gestión compartida',
        committedAmount: entry.committedAmount,
        deadlineDate: entry.deadlineDate,
        contactName: entry.contactName,
        contactPhone: entry.contactPhone,
        contactEmail: entry.contactEmail,
        observations: isCurrentAgentRecord
          ? 'La gestión quedó sincronizada para ambas agentes de la cartera compartida.'
          : 'La otra agente ya registró esta gestión para el cliente compartido.',
        aiVerdict: 'Válida',
        dynamicValues: entry.dynamicValues,
        status: entry.state || 'Contactado',
        isSharedManagement: true,
      }];
    });
  });
}
