import { Agent, Client, MoraRange } from '../types';

export interface MoraPhaseInfo {
  range: MoraRange;
  label: string;
  sublabel: string;
  badgeClass: string;
  bgGradient: string;
  textColor: string;
  borderColor: string;
  iconName: string;
}

export const MORA_PHASES: Record<MoraRange, MoraPhaseInfo> = {
  '0-30': {
    range: '0-30',
    label: '0-30 días',
    sublabel: 'No moroso (Factura dentro del período normal)',
    badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-800/60',
    bgGradient: 'from-blue-600/20 to-blue-900/30',
    textColor: 'text-blue-400',
    borderColor: 'border-blue-500/40',
    iconName: 'ShieldCheck',
  },
  '31-60': {
    range: '31-60',
    label: '31-60 días',
    sublabel: 'Primer contacto (Gestión preventiva)',
    badgeClass: 'bg-orange-950/80 text-orange-300 border-orange-800/60',
    bgGradient: 'from-orange-500/20 to-amber-900/30',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/40',
    iconName: 'PhoneCall',
  },
  '61-90': {
    range: '61-90',
    label: '61-90 días',
    sublabel: 'Segundo contacto (Seguimiento moderado)',
    badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    bgGradient: 'from-amber-500/20 to-yellow-900/30',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/40',
    iconName: 'Clock',
  },
  '91-120': {
    range: '91-120',
    label: '91-120 días',
    sublabel: 'Tercer contacto (Urgencia)',
    badgeClass: 'bg-orange-950/90 text-orange-200 border-orange-700/70',
    bgGradient: 'from-orange-600/25 to-red-950/40',
    textColor: 'text-orange-300',
    borderColor: 'border-orange-600/50',
    iconName: 'AlertTriangle',
  },
  '120+': {
    range: '120+',
    label: '120+ días',
    sublabel: 'Crítico (Requiere escalación inmediata)',
    badgeClass: 'bg-red-950/90 text-red-200 border-red-700/80',
    bgGradient: 'from-red-600/30 to-red-950/50',
    textColor: 'text-red-400',
    borderColor: 'border-red-600/60',
    iconName: 'AlertOctagon',
  },
};

export function calculateMoraRange(daysArrears: number): MoraRange {
  if (daysArrears <= 30) return '0-30';
  if (daysArrears <= 60) return '31-60';
  if (daysArrears <= 90) return '61-90';
  if (daysArrears <= 120) return '91-120';
  return '120+';
}

/**
 * Generates schedule business days (Monday to Friday) for the month
 */
export function getBusinessDaysInMonth(year: number, monthZeroIndexed: number): string[] {
  const days: string[] = [];
  const date = new Date(year, monthZeroIndexed, 1);
  while (date.getMonth() === monthZeroIndexed) {
    const dayOfWeek = date.getDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      days.push(date.toISOString().split('T')[0]);
    }
    date.setDate(date.getDate() + 1);
  }
  return days;
}

/**
 * Standard business calling time slots between 8:00 AM and 6:00 PM
 */
export const BUSINESS_HOURS_SLOTS = [
  '08:00 AM',
  '08:45 AM',
  '09:30 AM',
  '10:15 AM',
  '11:00 AM',
  '11:45 AM',
  '01:15 PM',
  '02:00 PM',
  '02:45 PM',
  '03:30 PM',
  '04:15 PM',
  '05:00 PM',
];

/**
 * Distribute clients equally among agents of the same country,
 * then partition each agent's portfolio across business days (Mon-Fri 8am-6pm).
 */
export function distributeClientsEqually(
  clients: Client[],
  agents: Agent[],
  year = 2026,
  monthZeroIndexed = 9 // October (0-indexed 9)
): Client[] {
  const businessDays = getBusinessDaysInMonth(year, monthZeroIndexed);
  const updatedClients: Client[] = [...clients];

  // Group agents by country (only users with role 'agente', not admins)
  const agentsSV = agents.filter((a) => a.country === 'SV' && a.status === 'activo' && a.role === 'agente');
  const agentsGT = agents.filter((a) => a.country === 'GT' && a.status === 'activo' && a.role === 'agente');

  const distributeForCountry = (countryAgents: Agent[], country: 'SV' | 'GT') => {
    if (countryAgents.length === 0) return;

    // Filter country clients
    const countryClientIndices = updatedClients
      .map((c, idx) => ({ client: c, idx }))
      .filter((item) => item.client.country === country);

    countryClientIndices.forEach(({ idx }, i) => {
      const assignedAgent = countryAgents[i % countryAgents.length];
      const agentClientIndex = Math.floor(i / countryAgents.length);
      const dayAssigned = businessDays[agentClientIndex % businessDays.length];
      const slotIndex = Math.floor(agentClientIndex / businessDays.length) % BUSINESS_HOURS_SLOTS.length;
      const scheduledTime = BUSINESS_HOURS_SLOTS[slotIndex];

      updatedClients[idx] = {
        ...updatedClients[idx],
        assignedAgentId: assignedAgent.id,
        scheduledTime,
      };
    });
  };

  distributeForCountry(agentsSV, 'SV');
  distributeForCountry(agentsGT, 'GT');

  return updatedClients;
}
