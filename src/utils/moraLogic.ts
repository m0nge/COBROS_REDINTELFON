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

/**
 * METHODOLOGY: DISTRIBUTION OF CLIENTS FROM DAY 1 TO 22 (DEFAULT: 40 PER DAY)
 * --------------------------------------------------------------------------
 * 1. Operational Window: Days 1 to 22 of the month (strictly never beyond day 22).
 * 2. Daily Goal: Configurable `clientsPerDay` (default 40 calls/day). Total capacity = 22 * clientsPerDay.
 * 3. Priority Multi-Call Strategy:
 *    - To fulfill the daily call volume, clients can and should be contacted multiple times:
 *      * Critical Clients (120+ days & 91-120 days): 3 rounds of calls.
 *        - Round 1 (Days 1-7): Immediate intervention & notice of service cut.
 *        - Round 2 (Days 8-15): Follow-up & negotiation of emergency payment agreement.
 *        - Round 3 (Days 16-22): Final closing before judicial escalation.
 *      * Moderate Mora Clients (31-60 & 61-90 days): 2 rounds of calls.
 *        - Round 1 (Days 1-11): Verification of invoice reception and payment scheduling.
 *        - Round 2 (Days 12-22): Confirmation of transfer and reconciliation.
 *      * Regular Clients (0-30 days / month billing): 1 to 2 rounds.
 *        - Round 1: Preventive reminder before invoice cutoff date.
 * 4. In the daily agenda, each call clearly displays the call round:
 *    e.g. "1ª Llamada (Corte/Preventivo)", "2ª Llamada (Seguimiento)", "3ª Llamada (Intensiva)".
 * 5. Dynamic Rebalancing:
 *    - When rescheduling to day D, if day D exceeds the quota (e.g. 41), the lowest urgency client on day D
 *      is automatically moved to day D+1 (without ever exceeding day 22).
 */
export const OPERATIONAL_DAYS_MAX = 22;

export interface ScheduledCallSlot {
  client: Client;
  scheduledDay: number;
  callRound: number;
  callRoundLabel: string;
  turnNumber: number;
  timeSlot: string;
}

export function buildWorkloadSchedule1To22(
  clients: Client[],
  clientsPerDay: number = 40
): Record<number, ScheduledCallSlot[]> {
  const schedule: Record<number, ScheduledCallSlot[]> = {};
  for (let d = 1; d <= OPERATIONAL_DAYS_MAX; d++) {
    schedule[d] = [];
  }

  if (!clients || clients.length === 0) return schedule;

  // 1. Separate clients by urgency tier
  const criticalTier = clients.filter((c) => c.moraRange === '120+' || c.moraRange === '91-120');
  const moderateTier = clients.filter((c) => c.moraRange === '61-90' || c.moraRange === '31-60');
  const normalTier = clients.filter((c) => c.moraRange === '0-30');

  // Sort each tier by highest debt first
  const sortByDebt = (a: Client, b: Client) => (b.totalDebt || 0) - (a.totalDebt || 0);
  criticalTier.sort(sortByDebt);
  moderateTier.sort(sortByDebt);
  normalTier.sort(sortByDebt);

  // Helper to add a call slot to a day
  const addSlot = (day: number, client: Client, round: number, roundLabel: string) => {
    const validDay = Math.min(Math.max(1, day), OPERATIONAL_DAYS_MAX);
    const daySlots = schedule[validDay];
    const turnNumber = daySlots.length + 1;
    const timeSlot = BUSINESS_HOURS_SLOTS[(turnNumber - 1) % BUSINESS_HOURS_SLOTS.length];

    daySlots.push({
      client: {
        ...client,
        scheduledDay: validDay,
        callRound: round,
        callRoundLabel: roundLabel,
      },
      scheduledDay: validDay,
      callRound: round,
      callRoundLabel: roundLabel,
      turnNumber,
      timeSlot,
    });
  };

  // 2. Schedule Critical Tier: 3 Rounds across Days 1-22
  criticalTier.forEach((client, i) => {
    // Round 1: Days 1 to 7
    const dayR1 = 1 + (i % 7);
    addSlot(dayR1, client, 1, '1ª Llamada (Corte Inmediato)');

    // Round 2: Days 8 to 15
    const dayR2 = 8 + (i % 8);
    addSlot(dayR2, client, 2, '2ª Llamada (Seguimiento Urgente)');

    // Round 3: Days 16 to 22
    const dayR3 = 16 + (i % 7);
    addSlot(dayR3, client, 3, '3ª Llamada (Cierre / Pre-Legal)');
  });

  // 3. Schedule Moderate Tier: 2 Rounds across Days 1-22
  moderateTier.forEach((client, i) => {
    // Round 1: Days 1 to 11
    const dayR1 = 1 + (i % 11);
    addSlot(dayR1, client, 1, '1ª Llamada (Gestión Preventiva)');

    // Round 2: Days 12 to 22
    const dayR2 = 12 + (i % 11);
    addSlot(dayR2, client, 2, '2ª Llamada (Verificación de Pago)');
  });

  // 4. Schedule Normal Tier (0-30 days / Factura del Mes): 1 to 2 Rounds
  normalTier.forEach((client, i) => {
    // Round 1 distributed across days 1 to 22
    const dayR1 = 1 + (i % OPERATIONAL_DAYS_MAX);
    addSlot(dayR1, client, 1, '1ª Llamada (Recordatorio de Factura)');

    // For clients with larger billing in 0-30, add a second follow-up before day 22
    if ((client.totalDebt || 0) > 200 || i % 2 === 0) {
      const dayR2 = Math.min(OPERATIONAL_DAYS_MAX, dayR1 + 7);
      if (dayR2 <= OPERATIONAL_DAYS_MAX && dayR2 !== dayR1) {
        addSlot(dayR2, client, 2, '2ª Llamada (Confirmación de Pago)');
      }
    }
  });

  // 5. Balance to target `clientsPerDay` (default 40) per day
  // If some days have less than `clientsPerDay`, repeat high-value pending clients for extra follow-up
  const allScheduledClients = [...criticalTier, ...moderateTier, ...normalTier];
  for (let d = 1; d <= OPERATIONAL_DAYS_MAX; d++) {
    let currentSlots = schedule[d];
    let poolIndex = 0;
    while (currentSlots.length < clientsPerDay && allScheduledClients.length > 0) {
      const client = allScheduledClients[poolIndex % allScheduledClients.length];
      poolIndex++;
      // Determine next round for this client
      const existingRounds = currentSlots.filter((s) => s.client.code === client.code).length;
      const nextRound = existingRounds + 1;
      const label = nextRound === 1 ? '1ª Llamada (Programada)' : `${nextRound}ª Llamada (Refuerzo de Cobro)`;
      addSlot(d, client, nextRound, label);
    }

    // If day has more than `clientsPerDay` (e.g. due to heavy concentration), trim or move excess
    if (currentSlots.length > clientsPerDay && d < OPERATIONAL_DAYS_MAX) {
      const excess = currentSlots.splice(clientsPerDay);
      excess.forEach((slot) => {
        addSlot(d + 1, slot.client, slot.callRound, slot.callRoundLabel);
      });
    }

    // Re-index turn numbers for the day
    schedule[d] = schedule[d].slice(0, clientsPerDay).map((slot, idx) => ({
      ...slot,
      turnNumber: idx + 1,
      timeSlot: BUSINESS_HOURS_SLOTS[idx % BUSINESS_HOURS_SLOTS.length],
    }));
  }

  return schedule;
}

/**
 * Reschedules a client call to `targetDay` (1 to 22), maintaining strict cap of `clientsPerDay`
 * by gracefully displacing the lowest urgency call to the following day (up to day 22).
 */
export function rescheduleClientInSchedule(
  currentSchedule: Record<number, ScheduledCallSlot[]>,
  client: Client,
  targetDay: number,
  clientsPerDay: number = 40,
  reason = 'Reprogramado por Agente / IA'
): Record<number, ScheduledCallSlot[]> {
  const newSchedule: Record<number, ScheduledCallSlot[]> = {};
  for (let d = 1; d <= OPERATIONAL_DAYS_MAX; d++) {
    newSchedule[d] = [...(currentSchedule[d] || [])];
  }

  const validTarget = Math.min(Math.max(1, targetDay), OPERATIONAL_DAYS_MAX);

  // Create new slot
  const existingClientSlots = newSchedule[validTarget].filter((s) => s.client.code === client.code);
  const nextRound = existingClientSlots.length + 1;
  const newSlot: ScheduledCallSlot = {
    client: {
      ...client,
      scheduledDay: validTarget,
      callRound: nextRound,
      callRoundLabel: `${nextRound}ª Llamada (${reason})`,
    },
    scheduledDay: validTarget,
    callRound: nextRound,
    callRoundLabel: `${nextRound}ª Llamada (${reason})`,
    turnNumber: 1, // will be re-indexed
    timeSlot: BUSINESS_HOURS_SLOTS[0],
  };

  // Insert at top of target day (priority)
  newSchedule[validTarget].unshift(newSlot);

  // Propagate displacements if any day exceeds `clientsPerDay`
  for (let d = validTarget; d <= OPERATIONAL_DAYS_MAX; d++) {
    if (newSchedule[d].length > clientsPerDay) {
      const displaced = newSchedule[d].pop(); // remove lowest priority from end of day
      if (displaced && d < OPERATIONAL_DAYS_MAX) {
        displaced.scheduledDay = d + 1;
        displaced.client.scheduledDay = d + 1;
        newSchedule[d + 1].push(displaced);
      }
    }

    // Re-index turns for day d
    newSchedule[d] = newSchedule[d].map((slot, idx) => ({
      ...slot,
      turnNumber: idx + 1,
      timeSlot: BUSINESS_HOURS_SLOTS[idx % BUSINESS_HOURS_SLOTS.length],
    }));
  }

  return newSchedule;
}
