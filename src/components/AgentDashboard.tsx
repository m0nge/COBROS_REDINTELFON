import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Agent, Client, ClientManagementHistoryItem, Country, DynamicField, GestionAuditRecord, ManagementState, MoraRange, Priority, isClientAssignedToAgent } from '../types';
import { authenticatedApiFetch } from '../services/authService';
import { mergeAgentManagementHistory } from '../utils/agentManagementHistory';
import {
  getAgendaEligibilityReadWarning,
  getManagementReadWarning,
  getMonthlyStateReadWarning,
} from '../utils/authoritativeManagement';
import {
  buildFutureAgendaUnavailableCodes,
  filterAgendaSlotsByPreviousMonthInvoice,
  preserveCompletedDailySlots,
  selectDailyAgendaRefillCandidates,
} from '../utils/dailyAgenda';
import { buildDailyAgendaDisplaySlots } from '../utils/dailyAgendaView';
import type { DailyAgendaDisplaySlot } from '../utils/dailyAgendaView';
import { buildDailyAgendaReportRows, createDailyAgendaPrintHtml } from '../utils/dailyAgendaReport';
import { GestionReadOnlyModal } from './GestionReadOnlyModal';
import { ClientManagementHistory } from './ClientManagementHistory';
import { MORA_PHASES, buildWorkloadSchedule1To22, ScheduledCallSlot, OPERATIONAL_DAYS_MAX, BUSINESS_HOURS_SLOTS } from '../utils/moraLogic';
import {
  formatMonthLabel,
  getElSalvadorDateKey,
  getElSalvadorDateParts,
  getManagementScheduledDateKey,
  getRecordDateKey,
  isCountableManagement,
  getWeekStartDateKey,
  shiftDateKey,
  toDateKey,
} from '../utils/gestionDates';
import {
  Users,
  PhoneCall,
  Clock,
  Download,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  CheckCircle2,
  Calendar,
  CalendarDays,
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
  Flame,
  CheckCheck,
  PhoneForwarded,
  ChevronLeft,
  ChevronRight,
  Wallet,
  Sparkles,
  Eye,
  History,
  Printer,
} from 'lucide-react';

interface AgentDashboardProps {
  currentCountry: Country;
  agent: Agent;
  clients: Client[];
  onOpenGestionModal: (client: Client) => void;
  initialSelectedDayKey?: string;
  onSelectedDayChange?: (dateKey: string) => void;
  onEditSavedGestion?: (record: GestionAuditRecord, client: Client) => void;
  selectedRangeFilter: MoraRange | 'TODOS';
  onSelectRange: (range: MoraRange | 'TODOS') => void;
  activeModule?: string;
  clientsPerDay?: number;
  readOnly?: boolean;
  persistedAuditRecords?: GestionAuditRecord[];
  dynamicFields?: DynamicField[];
  onOpenPaymentEvidence?: (path: string) => void | Promise<void>;
}

function getInitialSelectedDateParts(dateKey?: string) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const normalizedKey = new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
    if (normalizedKey === dateKey) return { year, month, day };
  }
  return getElSalvadorDateParts();
}

type MonthlyManagementSummary = {
  id: string;
  clientCode: string;
  clientName?: string;
  country: Country;
  agreement: string;
  outcome: 'contact' | 'promise' | 'payment_received';
  status: string;
  scheduledForDate: string;
  createdAt: string;
  agentId: string;
  time: string;
  channel: string;
  contactSuccess: string;
  durationSeconds?: number;
  committedAmount?: number;
  deadlineDate?: string;
  promiseTime?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  observations: string;
  aiVerdict?: 'Válida' | 'Inválida';
  aiScore?: number;
  totalDebt?: number;
  callRoundLabel?: string;
  dynamicValues?: Record<string, unknown>;
};

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  currentCountry,
  agent,
  clients,
  onOpenGestionModal,
  initialSelectedDayKey,
  onSelectedDayChange,
  onEditSavedGestion,
  selectedRangeFilter,
  onSelectRange,
  activeModule,
  clientsPerDay = 40,
  readOnly = false,
  persistedAuditRecords,
  dynamicFields = [],
  onOpenPaymentEvidence,
}) => {
  const [activeTab, setActiveTab] = useState<'lista-gestion' | 'mi-cartera' | 'metricas'>('lista-gestion');
  const [now, setNow] = useState<Date>(() => new Date());
  const [initialSelectedDate] = useState(() => getInitialSelectedDateParts(initialSelectedDayKey));
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number>(() => initialSelectedDate.day);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(
    () => `${initialSelectedDate.year}-${String(initialSelectedDate.month).padStart(2, '0')}`,
  );
  const previousCurrentMonthKey = useRef(selectedMonthKey);
  const [selectedPeriod, setSelectedPeriod] = useState<'hoy' | 'semana' | 'mes'>('hoy');
  const [viewingGestion, setViewingGestion] = useState<GestionAuditRecord | null>(null);
  const [expandedHistoryClientCode, setExpandedHistoryClientCode] = useState<string>('');
  const [dailySearchTerm, setDailySearchTerm] = useState<string>('');
  const [dailyStateFilter, setDailyStateFilter] = useState<string>('TODOS');

  const [stateFilter, setStateFilter] = useState<string>('TODOS');
  const [priorityFilter, setPriorityFilter] = useState<string>('TODOS');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [monthlyResolvedCodes, setMonthlyResolvedCodes] = useState<string[]>([]);
  const [monthlyAgendaEligibleCodes, setMonthlyAgendaEligibleCodes] = useState<string[]>([]);
  const [monthlyManagedSummaries, setMonthlyManagedSummaries] = useState<MonthlyManagementSummary[]>([]);
  const [monthlyStateLoaded, setMonthlyStateLoaded] = useState(false);
  const [monthlyStateError, setMonthlyStateError] = useState('');
  const todayParts = getElSalvadorDateParts(now);
  const todayKey = getElSalvadorDateKey(now);
  const currentMonthKey = todayKey.slice(0, 7);
  const [selectedYear, selectedMonth] = selectedMonthKey.split('-').map(Number);
  const selectedDayKey = toDateKey(selectedYear, selectedMonth, selectedDayOfMonth);
  const selectedWeekStartKey = getWeekStartDateKey(selectedDayKey);
  useEffect(() => {
    onSelectedDayChange?.(selectedDayKey);
  }, [onSelectedDayChange, selectedDayKey]);
  const weekDateKeys = Array.from({ length: 7 }, (_, index) => shiftDateKey(selectedWeekStartKey, index));
  const currentMonthLabel = formatMonthLabel(selectedYear, selectedMonth);
  const currentMonthShort = new Intl.DateTimeFormat('es-SV', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(selectedYear, selectedMonth - 1, 15, 12))).replace(/\./g, '');
  const selectedWeekdayLabel = new Intl.DateTimeFormat('es-SV', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(selectedYear, selectedMonth - 1, selectedDayOfMonth, 12)));
  const monthOptions = Array.from({ length: 13 }, (_, index) => {
    const date = new Date(Date.UTC(todayParts.year, todayParts.month - 1 + index - 6, 1, 12));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: formatMonthLabel(year, month),
    };
  });

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let isCurrentPeriod = true;
    let requestInFlight = false;
    let refreshQueued = false;
    setMonthlyStateLoaded(false);
    setMonthlyResolvedCodes([]);
    setMonthlyAgendaEligibleCodes([]);
    setMonthlyManagedSummaries([]);
    setMonthlyStateError('');
    const params = new URLSearchParams({
      action: 'estado-mensual',
      pais: currentCountry,
      mes: selectedMonthKey,
    });
    const loadMonthlyState = async () => {
      if (readOnly && persistedAuditRecords === undefined) {
        setMonthlyStateLoaded(false);
        setMonthlyStateError('Esperando una lectura confirmada de la bitácora administrativa.');
        return;
      }
      if (requestInFlight) {
        refreshQueued = true;
        return;
      }
      requestInFlight = true;
      try {
        const response = await authenticatedApiFetch(`/api/cartera?${params.toString()}`, {
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (
          !response.ok
          || !payload.success
          || !Array.isArray(payload.states)
          || !Array.isArray(payload.managed)
        ) {
          const details = [payload.error, payload.message].filter(Boolean).join(': ');
          throw new Error(details || 'El servidor no devolvió la bitácora persistida completa.');
        }
        if (!isCurrentPeriod) return;
        const managementWarning = getManagementReadWarning(payload);
        if (managementWarning) {
          setMonthlyResolvedCodes([]);
          setMonthlyAgendaEligibleCodes([]);
          setMonthlyManagedSummaries([]);
          setMonthlyStateError(`No se pudo verificar la bitácora en Supabase (${managementWarning}). La agenda queda bloqueada para no mostrar gestiones como pendientes.`);
          setMonthlyStateLoaded(false);
          return;
        }
        const agendaWarning = getAgendaEligibilityReadWarning(payload);
        setMonthlyAgendaEligibleCodes(
          Array.isArray(payload.agendaEligibleCodes)
            ? payload.agendaEligibleCodes.map((code: unknown) => String(code || '').trim().toUpperCase()).filter(Boolean)
            : [],
        );
        if (persistedAuditRecords !== undefined) {
          setMonthlyResolvedCodes([]);
          setMonthlyManagedSummaries([]);
          setMonthlyStateError(agendaWarning
            ? `No se pudo verificar la elegibilidad de facturas del mes anterior (${agendaWarning}); las agendas futuras se mantendrán vacías.`
            : '');
          setMonthlyStateLoaded(true);
          return;
        }
        const states = Array.isArray(payload.states) ? payload.states : [];
        setMonthlyResolvedCodes(
          states
            .filter((state: any) => state.pais === currentCountry && state.mes_periodo === selectedMonthKey)
            .map((state: any) => String(state.codigo_cliente)),
        );
        setMonthlyManagedSummaries(
          payload.managed.filter((record: any) =>
                record.country === currentCountry
                && String(record.scheduledForDate || '').slice(0, 7) === selectedMonthKey
                && record.id
                && record.clientCode
              ) as MonthlyManagementSummary[]
        );
        const monthlyWarning = getMonthlyStateReadWarning(payload);
        const stateErrors = [
          monthlyWarning
            ? `Las gestiones sí se verificaron; no se pudo actualizar el estado mensual de pagos (${monthlyWarning}).`
            : '',
          agendaWarning
            ? `No se pudo verificar la elegibilidad de facturas del mes anterior (${agendaWarning}); las agendas futuras se mantendrán vacías.`
            : '',
        ].filter(Boolean);
        setMonthlyStateError(stateErrors.join(' '));
        setMonthlyStateLoaded(true);
      } catch (error) {
        if (isCurrentPeriod) {
          const details = error instanceof Error ? error.message : 'Error desconocido';
          setMonthlyStateError(`No se pudo sincronizar las gestiones del día (${details}).`);
          setMonthlyStateLoaded(false);
          setMonthlyResolvedCodes([]);
          setMonthlyAgendaEligibleCodes([]);
          setMonthlyManagedSummaries([]);
        }
      } finally {
        requestInFlight = false;
        if (refreshQueued && isCurrentPeriod) {
          refreshQueued = false;
          void loadMonthlyState();
        }
      }
    };
    void loadMonthlyState();
    const refreshInterval = window.setInterval(() => void loadMonthlyState(), 20_000);
    window.addEventListener('focus', loadMonthlyState);
    window.addEventListener('red-cobranza:audit-sync-complete', loadMonthlyState);
    return () => {
      isCurrentPeriod = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', loadMonthlyState);
      window.removeEventListener('red-cobranza:audit-sync-complete', loadMonthlyState);
    };
  }, [currentCountry, selectedMonthKey, persistedAuditRecords]);

  useEffect(() => {
    if (selectedMonthKey === currentMonthKey) {
      setSelectedDayOfMonth(todayParts.day);
    }
  }, [todayParts.day, todayParts.month, todayParts.year, selectedMonthKey, currentMonthKey]);

  useEffect(() => {
    const previousCurrentMonth = previousCurrentMonthKey.current;
    if (previousCurrentMonth === currentMonthKey) return;
    previousCurrentMonthKey.current = currentMonthKey;
    if (selectedMonthKey === previousCurrentMonth) {
      setSelectedMonthKey(currentMonthKey);
      setSelectedDayOfMonth(todayParts.day);
      setSelectedPeriod('hoy');
    }
  }, [currentMonthKey, selectedMonthKey, todayParts.day]);

  useEffect(() => {
    if (activeModule === 'mi-cartera') {
      setActiveTab('mi-cartera');
    } else if (activeModule === 'lista-gestion') {
      setActiveTab('lista-gestion');
    }
  }, [activeModule]);

  // Filter clients assigned to this agent and matching active filters (only active clients)
  const agentClients = clients
    .filter((c) => {
      if (c.country !== currentCountry) return false;
      // Exclude inactive clients strictly as requested: "solo los activos deben salir en este sistema"
      const s = String(c.estatus || c.status || '').toUpperCase();
      if (s.includes('INACT') || s.includes('BAJA') || s.includes('CANCEL') || s.includes('SUSPEND') || s === 'NO ACTIVO') {
        return false;
      }
      // If client has assignedAgentId, it must belong to this agent
      return isClientAssignedToAgent(c, agent.id);
    })
    .map((client) => {
      if (!monthlyStateLoaded) return client;
      const isResolvedForMonth = monthlyResolvedCodes.includes(client.code);
      if (isResolvedForMonth) return { ...client, state: 'Resuelto' as ManagementState };
      return client.state === 'Resuelto'
        ? { ...client, state: 'Pendiente' as ManagementState }
        : client;
    })
    .sort((a, b) =>
      b.daysArrears - a.daysArrears
      || a.code.trim().toUpperCase().localeCompare(b.code.trim().toUpperCase())
    );

  const totalAssigned = agentClients.length;
  const resolvedPortfolioClients = agentClients.filter((client) => client.state === 'Resuelto').length;
  const portfolioEffectiveness = totalAssigned > 0
    ? Number(((resolvedPortfolioClients / totalAssigned) * 100).toFixed(1))
    : 0;
  const sharedManagementKeys = new Set<string>();
  const sharedAgentAuditRecords: GestionAuditRecord[] = agentClients.flatMap((client) => {
    if (!client.isSharedAssignment) return [];
    return (client.sharedManagementHistory || []).flatMap((entry) => {
      const at = new Date(entry.at);
      if (Number.isNaN(at.getTime())) return [];
      const dateKey = getElSalvadorDateKey(at);
      const key = `${client.country}:${client.code}:${dateKey}`;
      if (sharedManagementKeys.has(key)) return [];
      sharedManagementKeys.add(key);
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
        scheduledForDate: entry.scheduledForDate,
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
  const serverManagedAuditRecords: GestionAuditRecord[] = persistedAuditRecords !== undefined
    ? persistedAuditRecords.filter((record) =>
        record.country === currentCountry
        && (
          record.agentId === agent.id
          || String(record.agentName || '').trim().toLocaleLowerCase() === agent.name.trim().toLocaleLowerCase()
        ),
      )
    : monthlyManagedSummaries.flatMap((summary) => {
    const client = agentClients.find((candidate) => candidate.code === summary.clientCode);
    if (sharedAgentAuditRecords.some((record) => record.id === `shared-${summary.id}-${agent.id}`)) return [];
    const createdAt = new Date(summary.createdAt);
    if (Number.isNaN(createdAt.getTime())) return [];
    return [{
      id: summary.id,
      timestamp: summary.createdAt,
      date: new Intl.DateTimeFormat('es-SV', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'America/El_Salvador',
      }).format(createdAt),
      scheduledForDate: summary.scheduledForDate,
      time: summary.time || new Intl.DateTimeFormat('es-SV', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/El_Salvador',
      }).format(createdAt),
      agentId: agent.id,
      agentName: agent.name,
      clientCode: summary.clientCode,
      clientName: client?.name || summary.clientName || summary.clientCode,
      country: summary.country,
      channel: summary.channel || 'Gestión',
      durationSeconds: summary.durationSeconds,
      contactSuccess: summary.contactSuccess || 'Sí',
      agreement: summary.agreement,
      committedAmount: summary.committedAmount,
      deadlineDate: summary.deadlineDate,
      promiseTime: summary.promiseTime,
      contactName: summary.contactName,
      contactPhone: summary.contactPhone,
      contactEmail: summary.contactEmail,
      observations: summary.observations || '',
      aiVerdict: summary.aiVerdict || 'Válida',
      aiScore: summary.aiScore,
      totalDebt: summary.totalDebt ?? client?.totalDebt,
      callRoundLabel: summary.callRoundLabel,
      dynamicValues: {
        ...(summary.dynamicValues || {}),
        scheduledForDate: summary.scheduledForDate,
        periodMonth: String(summary.dynamicValues?.periodMonth || selectedMonthKey),
        paymentOutcome: summary.outcome === 'payment_received' ? 'payment_received' : summary.dynamicValues?.paymentOutcome,
      },
      status: summary.status as ManagementState,
    }];
  });
  const agentAuditRecords = [...sharedAgentAuditRecords, ...serverManagedAuditRecords];
  const latestManagementByClient = new Map<string, GestionAuditRecord>();
  const managementByClientDate = new Map<string, GestionAuditRecord>();
  agentAuditRecords.forEach((record) => {
    const scheduledDate = getManagementScheduledDateKey(record);
    if (!scheduledDate) return;
    const key = `${record.country}:${record.clientCode.trim().toUpperCase()}:${scheduledDate}`;
    const existing = managementByClientDate.get(key);
    const recordTimestamp = Date.parse(record.timestamp || '') || 0;
    const existingTimestamp = Date.parse(existing?.timestamp || '') || 0;
    if (!existing || recordTimestamp >= existingTimestamp) managementByClientDate.set(key, record);
  });
  serverManagedAuditRecords.forEach((record) => {
    if (!isCountableManagement(record)) return;
    const scheduledDate = getManagementScheduledDateKey(record);
    if (!scheduledDate || scheduledDate.slice(0, 7) !== selectedMonthKey) return;
    const key = `${record.country}:${record.clientCode.trim().toUpperCase()}`;
    const existing = latestManagementByClient.get(key);
    const recordTimestamp = Date.parse(record.timestamp || '') || 0;
    const existingTimestamp = Date.parse(existing?.timestamp || '') || 0;
    if (!existing || recordTimestamp >= existingTimestamp) latestManagementByClient.set(key, record);
  });
  const resolvedClientCodesThisMonth = useMemo(() => buildFutureAgendaUnavailableCodes(
    monthlyResolvedCodes,
    agentAuditRecords.map((record) => ({
      clientCode: record.clientCode,
      agreement: record.agreement,
      paymentOutcome: String(record.dynamicValues?.paymentOutcome || ''),
      assignedDate: String(
        record.scheduledForDate
        || record.dynamicValues?.scheduledForDate
        || record.dynamicValues?.periodMonth
        || getRecordDateKey(record)
        || '',
      ),
      countable: isCountableManagement(record),
    })),
    selectedMonthKey,
  ), [agentAuditRecords, selectedMonthKey, monthlyResolvedCodes]);
  const completedDailySlotKeys = useMemo(() => {
    const keys = new Set<string>();
    agentAuditRecords.forEach((record) => {
      if (!isCountableManagement(record)) return;
      const assignedDate = getManagementScheduledDateKey(record);
      if (!assignedDate || assignedDate.slice(0, 7) !== selectedMonthKey) return;
      keys.add(`${assignedDate}:${record.clientCode.trim().toUpperCase()}`);
    });
    return keys;
  }, [agentAuditRecords, selectedMonthKey]);
  const operationalDaysInWeek = weekDateKeys
    .filter((dateKey) => dateKey.slice(0, 7) === selectedMonthKey)
    .filter((dateKey) => Number(dateKey.slice(8, 10)) <= OPERATIONAL_DAYS_MAX)
    .filter((dateKey) => selectedMonthKey !== currentMonthKey || dateKey <= todayKey)
    .length;
  const effectiveDailyGoal = Math.min(clientsPerDay, totalAssigned);
  const targetDaysInSelectedMonth = selectedMonthKey === currentMonthKey
    ? Math.min(todayParts.day, OPERATIONAL_DAYS_MAX)
    : OPERATIONAL_DAYS_MAX;
  const periodGoal = selectedPeriod === 'hoy'
    ? (selectedDayOfMonth <= OPERATIONAL_DAYS_MAX ? effectiveDailyGoal : 0)
    : selectedPeriod === 'semana'
      ? effectiveDailyGoal * operationalDaysInWeek
      : effectiveDailyGoal * targetDaysInSelectedMonth;
  const weekDays = weekDateKeys.map((dateKey) => {
    const weekday = new Intl.DateTimeFormat('es-SV', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${dateKey}T12:00:00Z`));
    return weekday.replace(/\./g, '').slice(0, 3);
  });
  // Priority sorting algorithm for monthly workload:
  // 1. Level of mora urgency: '120+' (5), '91-120' (4), '61-90' (3), '31-60' (2), '0-30' (1)
  // 2. Highest debt first within same tier
  // 3. Pending clients first before resolved ones
  const moraUrgencyWeight: Record<string, number> = {
    '120+': 5,
    '91-120': 4,
    '61-90': 3,
    '31-60': 2,
    '0-30': 1,
  };

  const prioritizedClients = useMemo(() => {
    const monthlyResolvedSet = new Set(
      monthlyResolvedCodes.map((code) => String(code || '').trim().toUpperCase()),
    );
    return [...agentClients].sort((a, b) => {
      // A monthly payment resolution must not change the client's original
      // priority order on the day it was assigned; future-day exclusion happens
      // later when building the completed-aware schedule.
      const aResolved = a.state === 'Resuelto'
        && !monthlyResolvedSet.has(a.code.trim().toUpperCase()) ? 1 : 0;
      const bResolved = b.state === 'Resuelto'
        && !monthlyResolvedSet.has(b.code.trim().toUpperCase()) ? 1 : 0;
      if (aResolved !== bResolved) return aResolved - bResolved;

      // Higher mora range weight first
      const wA = moraUrgencyWeight[a.moraRange] || 0;
      const wB = moraUrgencyWeight[b.moraRange] || 0;
      if (wA !== wB) return wB - wA;

      // More days arrears first
      if (b.daysArrears !== a.daysArrears) return b.daysArrears - a.daysArrears;

      // Higher debt first
      return (b.totalDebt || 0) - (a.totalDebt || 0)
        || a.code.trim().toUpperCase().localeCompare(b.code.trim().toUpperCase());
    });
  }, [agentClients, monthlyResolvedCodes]);

  // The same fixed portfolio is planned against whichever month the user selects.
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();

  const workloadSchedule = useMemo(() => {
    // Keep today's current-month list stable. The earlier portfolio feed had
    // no verified SAN mora, so preserve the agenda order it produced while using
    // the refreshed SAN values to prioritize the days after today.
    const scheduleClients = prioritizedClients;
    const invoiceEligibleSet = new Set(
      monthlyAgendaEligibleCodes.map((code) => String(code || '').trim().toUpperCase()),
    );
    const agendaClients = selectedMonthKey < currentMonthKey
      ? prioritizedClients
      : prioritizedClients.filter((client) =>
        invoiceEligibleSet.has(client.code.trim().toUpperCase()),
      );
    const schedule = buildWorkloadSchedule1To22(scheduleClients, clientsPerDay);
    const protectedThroughDay = selectedMonthKey === currentMonthKey ? todayParts.day : 0;
    const legacyTodaySchedule = protectedThroughDay > 0
      ? buildWorkloadSchedule1To22(
        prioritizedClients
          .map((client) => ({
            ...client,
            totalDebt: 0,
            daysArrears: 0,
            moraRange: '0-30' as const,
          }))
          .sort((left, right) =>
            left.code.trim().toUpperCase().localeCompare(right.code.trim().toUpperCase())
          ),
        clientsPerDay,
        )[protectedThroughDay] || []
      : [];
    const explicitlyScheduled = scheduleClients.filter(
      (client) => client.scheduledDate?.startsWith(selectedMonthKey)
    );

    [...explicitlyScheduled].reverse().forEach((client) => {
      for (const day of Object.keys(schedule)) {
        schedule[Number(day)] = schedule[Number(day)].filter((slot) => slot.client.code !== client.code);
      }
      const day = Number(client.scheduledDate?.slice(8, 10));
      if (!day || day > daysInMonth) return;
      const targetSlots = (schedule[day] ||= []);
      const round = client.callRound || 2;
      const label = client.callRoundLabel || `${round}ª Llamada (Seguimiento)`;
      targetSlots.unshift({
        client: { ...client, scheduledDay: day, callRound: round, callRoundLabel: label },
        scheduledDay: day,
        callRound: round,
        callRoundLabel: label,
        turnNumber: 1,
        timeSlot: client.scheduledTime || '08:00 AM',
      });
    });

    if (protectedThroughDay > 0 && protectedThroughDay <= daysInMonth) {
      const dateKey = toDateKey(selectedYear, selectedMonth, protectedThroughDay);
      const scheduledToday = explicitlyScheduled.filter(
        (client) => String(client.scheduledDate || '').slice(0, 10) === dateKey,
      );
      const explicitlyScheduledTodayCodes = new Set(
        scheduledToday.map((client) => client.code.trim().toUpperCase()),
      );
      const clientByCode = new Map(
        prioritizedClients.map((client) => [client.code.trim().toUpperCase(), client]),
      );
      const preservedSlots = legacyTodaySchedule.flatMap((slot) => {
        const code = slot.client.code.trim().toUpperCase();
        const client = clientByCode.get(code);
        if (!client || explicitlyScheduledTodayCodes.has(code)) return [];
        return [{
          ...slot,
          client: {
            ...client,
            scheduledDay: protectedThroughDay,
            callRound: slot.callRound,
            callRoundLabel: slot.callRoundLabel,
          },
          scheduledDay: protectedThroughDay,
        }];
      });
      [...scheduledToday].reverse().forEach((client) => {
        const round = client.callRound || 2;
        const label = client.callRoundLabel || `${round}ª Llamada (Seguimiento)`;
        preservedSlots.unshift({
          client: { ...client, scheduledDay: protectedThroughDay, callRound: round, callRoundLabel: label },
          scheduledDay: protectedThroughDay,
          callRound: round,
          callRoundLabel: label,
          turnNumber: 1,
          timeSlot: client.scheduledTime || '08:00 AM',
        });
      });
      schedule[protectedThroughDay] = preservedSlots.map((slot, index) => ({
        ...slot,
        turnNumber: index + 1,
      }));
    }

    Object.keys(schedule).forEach((dayKey) => {
      const day = Number(dayKey);
      schedule[day] = filterAgendaSlotsByPreviousMonthInvoice(
        schedule[day] || [],
        monthlyAgendaEligibleCodes,
        {
          selectedMonthKey,
          currentMonthKey,
          day,
          protectedThroughDay,
        },
      );
    });

    // Keep explicit reschedules ahead of routine calls, moving lower-priority
    // calls into later open slots before filling remaining daily vacancies.
    const dailyTarget = Math.min(clientsPerDay, agendaClients.length);
    const priorityIndex = new Map(scheduleClients.map((client, index) => [client.code, index]));
    for (let day = 1; day <= OPERATIONAL_DAYS_MAX; day++) {
      if (day <= protectedThroughDay) continue;
      const daySlots = schedule[day] ||= [];
      while (daySlots.length > dailyTarget) {
        const displaced = daySlots.pop();
        if (!displaced) break;

        let destinationDay = day + 1;
        while (destinationDay <= OPERATIONAL_DAYS_MAX) {
          const destinationSlots = schedule[destinationDay] ||= [];
          if (
            destinationSlots.length < dailyTarget
            && !destinationSlots.some((slot) => slot.client.code === displaced.client.code)
          ) break;
          destinationDay += 1;
        }
        if (destinationDay > OPERATIONAL_DAYS_MAX) continue;

        const destinationSlots = schedule[destinationDay];
        displaced.scheduledDay = destinationDay;
        displaced.turnNumber = destinationSlots.length + 1;
        displaced.timeSlot = BUSINESS_HOURS_SLOTS[destinationSlots.length % BUSINESS_HOURS_SLOTS.length];
        displaced.client = { ...displaced.client, scheduledDay: destinationDay };
        destinationSlots.push(displaced);
      }
    }

    // Fill only genuine vacancies; an explicitly dated client must not be
    // pulled into a second day as a replacement call.
    const explicitlyScheduledCodes = new Set(explicitlyScheduled.map((client) => client.code));
    const callCounts = new Map<string, number>();
    Object.values(schedule).forEach((slots) => {
      slots.forEach((slot) => callCounts.set(slot.client.code, (callCounts.get(slot.client.code) || 0) + 1));
    });

    for (let day = 1; day <= OPERATIONAL_DAYS_MAX; day++) {
      if (day <= protectedThroughDay) continue;
      const daySlots = schedule[day] ||= [];
      const scheduledCodes = new Set(daySlots.map((slot) => slot.client.code));
      while (daySlots.length < dailyTarget) {
        const candidate = agendaClients
          .filter((client) => !explicitlyScheduledCodes.has(client.code) && !scheduledCodes.has(client.code))
          .sort((left, right) =>
            (callCounts.get(left.code) || 0) - (callCounts.get(right.code) || 0)
            || (priorityIndex.get(left.code) || 0) - (priorityIndex.get(right.code) || 0)
          )[0];
        if (!candidate) break;

        const round = (callCounts.get(candidate.code) || 0) + 1;
        const label = round === 1
          ? '1ª Llamada (Reposición de agenda)'
          : `${round}ª Llamada (Seguimiento por mora)`;
        daySlots.push({
          client: { ...candidate, scheduledDay: day, callRound: round, callRoundLabel: label },
          scheduledDay: day,
          callRound: round,
          callRoundLabel: label,
          turnNumber: daySlots.length + 1,
          timeSlot: BUSINESS_HOURS_SLOTS[daySlots.length % BUSINESS_HOURS_SLOTS.length],
        });
        scheduledCodes.add(candidate.code);
        callCounts.set(candidate.code, round);
      }
    }

    Object.values(schedule).forEach((slots) => {
      slots.forEach((slot, index) => {
        slot.turnNumber = index + 1;
      });
    });
    const completedCodesByDate = new Map<string, Set<string>>();
    agentAuditRecords.forEach((record) => {
      if (!isCountableManagement(record)) return;
      const dateKey = getManagementScheduledDateKey(record);
      if (!dateKey || dateKey.slice(0, 7) !== selectedMonthKey) return;
      const codes = completedCodesByDate.get(dateKey) || new Set<string>();
      codes.add(record.clientCode.trim().toUpperCase());
      completedCodesByDate.set(dateKey, codes);
    });

    const explicitDateByCode = new Map(
      explicitlyScheduled.map((client) => [client.code, String(client.scheduledDate).slice(0, 10)]),
    );
    const plannedCallCounts = new Map<string, number>();
    Object.values(schedule).forEach((slots) => {
      slots.forEach((slot) => {
        plannedCallCounts.set(
          slot.client.code,
          (plannedCallCounts.get(slot.client.code) || 0) + 1,
        );
      });
    });

    const lastScheduledDay = Math.max(
      OPERATIONAL_DAYS_MAX,
      ...Object.keys(schedule).map(Number),
    );
    const completedAwareSchedule: Record<number, ScheduledCallSlot[]> = {};
    for (let day = 1; day <= lastScheduledDay; day++) {
      const dateKey = toDateKey(selectedYear, selectedMonth, day);
      const recordedCompletedCodes = completedCodesByDate.get(dateKey) || new Set<string>();
      const shouldRequirePriorMonthInvoice = selectedMonthKey > currentMonthKey
        || (selectedMonthKey === currentMonthKey && day > protectedThroughDay);
      const completedCodes = shouldRequirePriorMonthInvoice
        ? new Set(
          [...recordedCompletedCodes].filter((code) => invoiceEligibleSet.has(code)),
        )
        : recordedCompletedCodes;
      const pendingTarget = day <= OPERATIONAL_DAYS_MAX
        ? Math.max(dailyTarget, completedCodes.size)
        : (schedule[day] || []).length;
      const protectedDay = day <= protectedThroughDay;
      const daySlots = protectedDay
        ? (schedule[day] || [])
        : preserveCompletedDailySlots(schedule[day] || [], {
          target: pendingTarget,
          dateKey,
          completedCodes,
          resolvedCodes: resolvedClientCodesThisMonth,
          completedDailySlotKeys,
        });
      const dayCodes = new Set(
        daySlots.map((slot) => slot.client.code.trim().toUpperCase()),
      );

      if (!protectedDay && day <= OPERATIONAL_DAYS_MAX && daySlots.length < pendingTarget) {
        const unavailableCodes = new Set([
          ...resolvedClientCodesThisMonth,
          ...completedCodes,
        ]);
        const refillCandidates = selectDailyAgendaRefillCandidates(agendaClients, {
          target: pendingTarget,
          dateKey,
          currentCodes: dayCodes,
          unavailableCodes,
          completedDailySlotKeys,
          explicitDateByCode,
          plannedCallCounts,
          priorityIndex,
        });

        refillCandidates.forEach((candidate) => {
          const priorDates = new Set<string>();
          Object.entries(completedAwareSchedule).forEach(([scheduledDay, slots]) => {
            if (Number(scheduledDay) >= day) return;
            slots.forEach((slot) => {
              if (slot.client.code === candidate.code) {
                priorDates.add(toDateKey(selectedYear, selectedMonth, Number(scheduledDay)));
              }
            });
          });
          agentAuditRecords.forEach((record) => {
            const recordDateKey = getManagementScheduledDateKey(record);
            if (
              record.clientCode === candidate.code
              && isCountableManagement(record)
              && recordDateKey
              && recordDateKey < dateKey
            ) {
              priorDates.add(recordDateKey);
            }
          });
          const callRound = priorDates.size + 1;
          const callRoundLabel = callRound === 1
            ? '1ª Llamada (Reposición de agenda)'
            : `${callRound}ª Llamada (Seguimiento por mora)`;
          const turnNumber = daySlots.length + 1;
          daySlots.push({
            client: {
              ...candidate,
              scheduledDay: day,
              callRound,
              callRoundLabel,
            },
            scheduledDay: day,
            callRound,
            callRoundLabel,
            turnNumber,
            timeSlot: BUSINESS_HOURS_SLOTS[(turnNumber - 1) % BUSINESS_HOURS_SLOTS.length],
          });
          dayCodes.add(candidate.code);
          plannedCallCounts.set(candidate.code, (plannedCallCounts.get(candidate.code) || 0) + 1);
        });
      }

      completedAwareSchedule[day] = daySlots;
    }

    return completedAwareSchedule;
  }, [prioritizedClients, monthlyAgendaEligibleCodes, agentAuditRecords, resolvedClientCodesThisMonth, completedDailySlotKeys, clientsPerDay, selectedMonthKey, selectedYear, selectedMonth, daysInMonth, currentMonthKey, todayParts.day]);

  const daysDistribution = useMemo(() => {
    const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const days: Array<{
      dayNumber: number;
      dateKey: string;
      dateStr: string;
      weekdayName: string;
      slots: ScheduledCallSlot[];
      clients: Client[];
      totalDebt: number;
      resolvedDebt: number;
      criticalCount: number;
      resolvedCount: number;
      managedCount: number;
      followUpCount: number;
    }> = [];

    // Show all calendar days so a same-month reschedule can be selected and found.
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(selectedYear, selectedMonth - 1, d, 12));
      const wDayName = weekdays[dt.getUTCDay()];
      const dateKey = toDateKey(selectedYear, selectedMonth, d);
      const managedCount = new Set(agentAuditRecords
        .filter((record) => {
          return isCountableManagement(record) && getManagementScheduledDateKey(record) === dateKey;
        })
        .map((record) => record.clientCode)).size;
      const remainingDailyQuota = Math.max(
        0,
        Math.min(clientsPerDay, totalAssigned) - managedCount,
      );
      const daySlots = (workloadSchedule[d] || []).slice(0, remainingDailyQuota);
      const dayClients = daySlots.map((s) => s.client);
      const totalDebt = dayClients.filter((c) => c.debtVerified !== false).reduce((sum, c) => sum + (c.totalDebt || 0), 0);
      const resolvedDebt = dayClients
        .filter((c) => c.state === 'Resuelto' && c.debtVerified !== false)
        .reduce((sum, c) => sum + (c.totalDebt || 0), 0);
      const criticalCount = dayClients.filter((c) => c.debtVerified !== false && c.daysArrears >= 90).length;
      const resolvedCount = dayClients.filter((c) => c.state === 'Resuelto').length;

      days.push({
        dayNumber: d,
        dateKey,
        dateStr: `${String(d).padStart(2, '0')} ${new Intl.DateTimeFormat('es-SV', {
          month: 'short',
          timeZone: 'UTC',
        }).format(dt).replace(/\./g, '')}`,
        weekdayName: wDayName,
        slots: daySlots,
        clients: dayClients,
        totalDebt,
        resolvedDebt,
        criticalCount,
        resolvedCount,
        managedCount,
        followUpCount: daySlots.filter((slot) => slot.callRound >= 2).length,
      });
    }

    return days;
  }, [workloadSchedule, selectedYear, selectedMonth, daysInMonth, agentAuditRecords, clientsPerDay, totalAssigned]);

  const activeDayPlan = daysDistribution.find((day) => day.dayNumber === selectedDayOfMonth);
  const selectedDayRecords = agentAuditRecords.filter((record) => getRecordDateKey(record) === selectedDayKey);
  const getComplianceDate = (record: GestionAuditRecord) => {
    return getManagementScheduledDateKey(record);
  };
  const periodAuditRecords = agentAuditRecords.filter((record) => {
    if (!isCountableManagement(record)) return false;
    const complianceDate = getComplianceDate(record);
    if (!complianceDate || complianceDate > todayKey || complianceDate.slice(0, 7) !== selectedMonthKey) return false;
    if (selectedPeriod === 'hoy') return complianceDate === selectedDayKey;
    if (selectedPeriod === 'semana') {
      return complianceDate >= selectedWeekStartKey && complianceDate <= shiftDateKey(selectedWeekStartKey, 6);
    }
    return true;
  });
  const weeklyRecordCounts = weekDateKeys.map((dateKey) => {
    if (dateKey > todayKey || dateKey.slice(0, 7) !== selectedMonthKey) return 0;
    return new Set(agentAuditRecords
      .filter((record) => isCountableManagement(record) && getComplianceDate(record) === dateKey)
      .map((record) => record.clientCode)).size;
  });
  const weeklyAgreementCounts = weekDateKeys.map((dateKey) => {
    if (dateKey > todayKey || dateKey.slice(0, 7) !== selectedMonthKey) return 0;
    return new Set(agentAuditRecords.filter((record) => {
          if (!isCountableManagement(record) || getComplianceDate(record) !== dateKey) return false;
          const agreement = (record.agreement || '').toLocaleLowerCase();
          return agreement.includes('promesa') || agreement.includes('negociación');
        }).map((record) => record.clientCode)).size;
  });
  const maxWeeklyRecordCount = Math.max(1, ...weeklyRecordCounts);
  const maxWeeklyAgreementCount = Math.max(1, ...weeklyAgreementCounts);
  const dailyContactStats = weekDays.map((day, idx) => ({
    day,
    count: weeklyRecordCounts[idx],
    x: 28 + idx * 50,
    y: 110 - (weeklyRecordCounts[idx] / maxWeeklyRecordCount) * 75,
  }));
  const dailyAgreementStats = weekDays.map((day, idx) => ({
    day,
    count: weeklyAgreementCounts[idx],
    x: 28 + idx * 50,
    y: 110 - (weeklyAgreementCounts[idx] / maxWeeklyAgreementCount) * 75,
  }));
  const totalWeeklyAgreements = weeklyAgreementCounts.reduce((sum, count) => sum + count, 0);
  const contactLinePath = dailyContactStats.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.x} ${d.y}`).join(' ');
  const contactAreaPath = `${contactLinePath} L 328 110 L 28 110 Z`;
  const agreementLinePath = dailyAgreementStats.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.x} ${d.y}`).join(' ');
  const agreementAreaPath = `${agreementLinePath} L 328 110 L 28 110 Z`;
  const selectedDayCompletionRecords = useMemo(
    () => agentAuditRecords.filter((record) =>
      isCountableManagement(record) && getComplianceDate(record) === selectedDayKey
    ),
    [agentAuditRecords, selectedDayKey],
  );
  const currentCountryClients = useMemo(
    () => clients.filter((client) => client.country === currentCountry),
    [clients, currentCountry],
  );
  const liveDisplayedDaySlots = useMemo(
    () => buildDailyAgendaDisplaySlots(
      activeDayPlan?.slots || [],
      selectedDayCompletionRecords,
      currentCountryClients,
      selectedDayOfMonth,
    ),
    [activeDayPlan?.slots, selectedDayCompletionRecords, currentCountryClients, selectedDayOfMonth],
  );
  const displayedDaySlots: DailyAgendaDisplaySlot[] = monthlyStateLoaded ? liveDisplayedDaySlots : [];
  const todayResolvedSlots = monthlyStateLoaded
    ? new Set(selectedDayCompletionRecords.map((record) => record.clientCode)).size
    : 0;
  const todayTotalSlots = displayedDaySlots.length;
  const todayPendingSlots = displayedDaySlots.filter((slot) => !slot.management).length;
  const todayGoal = activeDayPlan
    ? Math.min(clientsPerDay, Math.max(todayTotalSlots, todayResolvedSlots))
    : 0;
  const todayDailyPct = todayGoal > 0 ? Number(((todayResolvedSlots / todayGoal) * 100).toFixed(1)) : 0.0;
  const summaryRecords = selectedPeriod === 'hoy' ? selectedDayCompletionRecords : periodAuditRecords;
  const summaryClientCount = new Set(summaryRecords.map((record) => record.clientCode)).size;
  const summaryProgressCount = selectedPeriod === 'hoy' ? todayResolvedSlots : summaryRecords.length;
  const summaryGoal = selectedPeriod === 'hoy' ? todayGoal : periodGoal;
  const monthlyManagedClientCount = new Set(periodAuditRecords.map((record) => record.clientCode)).size;
  const summaryProgress = selectedPeriod === 'mes'
    ? totalAssigned > 0
      ? Number(((monthlyManagedClientCount / totalAssigned) * 100).toFixed(1))
      : 0
    : summaryGoal > 0
      ? Number(((summaryProgressCount / summaryGoal) * 100).toFixed(1))
      : 0;
  const summaryProgressLabel = selectedPeriod === 'mes'
    ? `${monthlyManagedClientCount} / ${totalAssigned} con gestión`
    : summaryGoal > 0
      ? `${summaryProgressCount} / ${summaryGoal}`
      : 'Sin meta operativa';
  const summaryProgressDescription = selectedPeriod === 'mes'
    ? `${monthlyManagedClientCount} de ${totalAssigned} clientes con gestión en ${currentMonthLabel}`
    : summaryGoal > 0
      ? `Meta del periodo: ${summaryGoal} gestiones`
      : 'Fuera de la ventana operativa del 1 al 22';
  const selectDayForSummary = (day: number) => {
    setSelectedDayOfMonth(day);
    setSelectedPeriod('hoy');
    onSelectedDayChange?.(toDateKey(selectedYear, selectedMonth, day));
  };
  const selectMonth = (monthKey: string) => {
    const nextDay = monthKey === currentMonthKey ? todayParts.day : 1;
    setSelectedMonthKey(monthKey);
    setSelectedDayOfMonth(nextDay);
    setSelectedPeriod(monthKey === currentMonthKey ? 'hoy' : 'mes');
    const [year, month] = monthKey.split('-').map(Number);
    onSelectedDayChange?.(toDateKey(year, month, nextDay));
  };
  const goToToday = () => {
    setSelectedMonthKey(currentMonthKey);
    setSelectedDayOfMonth(todayParts.day);
    setSelectedPeriod('hoy');
    onSelectedDayChange?.(todayKey);
  };

  const findSlotGestion = (slot: DailyAgendaDisplaySlot) => {
    if (slot.management) return slot.management;
    const managementForDay = managementByClientDate.get(
      `${slot.client.country}:${slot.client.code.trim().toUpperCase()}:${selectedDayKey}`,
    );
    if (managementForDay) return managementForDay;
    const clientRecords = selectedDayCompletionRecords.filter((record) => record.clientCode === slot.client.code);
    return clientRecords.find((record) =>
      record.callRoundLabel && slot.callRoundLabel && record.callRoundLabel === slot.callRoundLabel
    ) || clientRecords[0];
  };

  const getClientGestionDate = (client: Client) => {
    const belongsToSelectedAgendaDay = activeDayPlan?.slots.some(
      (slot) => slot.client.code === client.code && slot.client.country === client.country,
    );
    if (activeTab === 'lista-gestion' && belongsToSelectedAgendaDay) return selectedDayKey;

    const plannedDay = daysDistribution.find((day) =>
      day.slots.some((slot) => slot.client.code === client.code && slot.client.country === client.country)
    );
    return plannedDay?.dateKey
      || (client.scheduledDate?.startsWith(selectedMonthKey) ? client.scheduledDate : todayKey);
  };

  const getManagementForClientDate = (client: Client, scheduledDate: string) => (
    managementByClientDate.get(
      `${client.country}:${client.code.trim().toUpperCase()}:${scheduledDate}`,
    )
  );

  const openGestionForClient = (client: Client) => {
    if (!monthlyStateLoaded) return;
    const scheduledDate = getClientGestionDate(client);
    const existingDayManagement = getManagementForClientDate(client, scheduledDate)
      || (activeTab === 'mi-cartera' && selectedMonthKey === currentMonthKey
        ? getManagementForClientDate(client, todayKey)
        : undefined);
    if (existingDayManagement) {
      setViewingGestion(existingDayManagement);
      return;
    }
    const managementHistory: ClientManagementHistoryItem[] = mergeAgentManagementHistory(
      serverManagedAuditRecords,
      client.country,
      client.code,
      selectedMonthKey,
    );
    onOpenGestionModal({
      ...client,
      managementHistory,
      portfolioDateForGestion: scheduledDate,
    });
  };

  // Filtered daily slots for the selected day
  const filteredDailySlots = displayedDaySlots.filter((slot) => {
    const c = slot.client;
    const isRegistered = Boolean(findSlotGestion(slot));
    const rowState = isRegistered ? 'Gestionado' : 'Pendiente';
    if (dailyStateFilter !== 'TODOS' && rowState !== dailyStateFilter) return false;
    if (dailySearchTerm.trim()) {
      const q = dailySearchTerm.toLowerCase();
      const matchName = c.name?.toLowerCase().includes(q);
      const matchCode = c.code?.toLowerCase().includes(q);
      const matchPhone = c.phone1?.toLowerCase().includes(q) || c.celular?.toLowerCase().includes(q);
      const matchRound = slot.callRoundLabel?.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchPhone && !matchRound) return false;
    }
    return true;
  });

  // Apply table filters for general portfolio
  const filteredClients = agentClients.filter((c) => {
    if (selectedRangeFilter !== 'TODOS' && (c.debtVerified === false || c.moraRange !== selectedRangeFilter)) return false;
    if (stateFilter !== 'TODOS' && c.state !== stateFilter) return false;
    if (priorityFilter !== 'TODOS' && c.priority !== priorityFilter) return false;
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      const matchName = c.name?.toLowerCase().includes(q);
      const matchCode = c.code?.toLowerCase().includes(q);
      const matchPhone = c.phone1?.toLowerCase().includes(q) || c.celular?.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchPhone) return false;
    }
    return true;
  });

  const handleExportXLSX = (tipo: 'diario' | 'acuerdos' | 'no_contactados') => {
    setIsExportMenuOpen(false);
    let exportData = filteredClients;
    let filename = `Reporte_${tipo}_${agent.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

    if (tipo === 'acuerdos') {
      exportData = filteredClients.filter((c) => c.state === 'Resuelto');
    } else if (tipo === 'no_contactados') {
      exportData = filteredClients.filter((c) => c.state === 'No Contactado');
    }

    const headers = [
      'Código Cliente',
      'Nombre Cliente',
      'País',
      'Días Mora',
      'Rango Mora',
      'Deuda Total',
      'Última Gestión',
      'Tipo Gestión',
      'Estado',
      'Prioridad',
      'Teléfono',
      'Celular',
      'Gestor Comercial',
    ];

    const countryLabel = currentCountry === 'SV' ? 'El Salvador' : 'Guatemala';
    const currencyFormat = currentCountry === 'SV' ? '$ #,##0.00' : 'Q #,##0.00';

    const rows = exportData.map((c) => [
      c.code,
      c.name,
      countryLabel,
      c.debtVerified === false ? 'Pendiente de consultar en SAN' : Number(c.daysArrears || 0),
      c.debtVerified === false ? 'Pendiente de consultar en SAN' : c.moraRange || '0-30',
      c.debtVerified === false ? 'Pendiente de consultar en SAN' : Number(c.totalDebt || 0),
      c.lastManagementDate || '',
      c.lastManagementType || '',
      c.state || 'Pendiente',
      c.priority || 'Normal',
      c.phone1 || c.celular || '',
      c.celular || '',
      c.salesManager || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!freeze'] = { ySplit: 1 };
    ws['!autofilter'] = { ref: 'A1:M1' };
    ws['!cols'] = [
      { wch: 15 },
      { wch: 40 },
      { wch: 15 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 28 },
      { wch: 20 },
      { wch: 18 },
      { wch: 15 },
      { wch: 18 },
      { wch: 18 },
      { wch: 30 },
    ];

    const darkHeaderStyle = {
      fill: { fgColor: { rgb: '1F2937' } },
      font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
      alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'D1D5DB' } },
        bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
        left: { style: 'thin', color: { rgb: 'D1D5DB' } },
        right: { style: 'thin', color: { rgb: 'D1D5DB' } },
      },
    } as const;

    headers.forEach((_, index) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: index });
      const cell = ws[cellRef];
      if (cell) {
        cell.s = darkHeaderStyle;
      }
    });

    const lastRowIndex = rows.length + 1;
    for (let r = 1; r < lastRowIndex; r += 1) {
      for (let c = 0; c < 13; c += 1) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellRef];
        if (!cell) continue;

        if (c === 3) {
          cell.t = 'n';
          cell.z = '#,##0';
        }
        if (c === 5) {
          cell.t = 'n';
          cell.z = currencyFormat;
          cell.s = { numFmt: currencyFormat, alignment: { wrapText: true } };
        }
        if (c === 6 || c === 7 || c === 10 || c === 11) {
          cell.s = { alignment: { wrapText: true } };
        }
        if (c === 0 || c === 1 || c === 2 || c === 7 || c === 8 || c === 9 || c === 12) {
          cell.s = { ...(cell.s || {}), alignment: { wrapText: true, vertical: 'center' } };
        }
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, 'Reporte');
    XLSX.writeFile(workbook, filename);
  };

  const getDailyReportRows = () => buildDailyAgendaReportRows(
    displayedDaySlots,
    currentCountry === 'SV' ? 'El Salvador' : 'Guatemala',
  );

  const handleExportDailyXLSX = () => {
    const reportRows = getDailyReportRows();
    if (reportRows.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(reportRows);
    const headers = Object.keys(reportRows[0]);
    worksheet['!freeze'] = { ySplit: 1 };
    worksheet['!autofilter'] = {
      ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${reportRows.length + 1}`,
    };
    worksheet['!cols'] = headers.map((header) => ({
      wch: Math.min(38, Math.max(12, header.length + 4)),
    }));

    const balanceIndex = headers.indexOf('Saldo SAN');
    if (balanceIndex >= 0) {
      for (let rowIndex = 1; rowIndex <= reportRows.length; rowIndex += 1) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: balanceIndex });
        const cell = worksheet[cellRef];
        if (!cell || typeof cell.v !== 'number') continue;
        cell.t = 'n';
        cell.z = currentCountry === 'GT' ? '"Q" #,##0.00' : '"$" #,##0.00';
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gestión del día');
    const safeAgentName = agent.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    XLSX.writeFile(workbook, `Gestion_${safeAgentName}_${selectedDayKey}.xlsx`);
  };

  const handlePrintDailyPdf = () => {
    const reportRows = getDailyReportRows();
    if (reportRows.length === 0) return;

    const selectedDate = new Date(Date.UTC(selectedYear, selectedMonth - 1, selectedDayOfMonth, 12));
    const dateLabel = new Intl.DateTimeFormat('es-SV', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(selectedDate);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para descargar el PDF.');
      return;
    }
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(createDailyAgendaPrintHtml(reportRows, {
      agentName: agent.name,
      countryLabel: currentCountry === 'SV' ? 'El Salvador' : 'Guatemala',
      dateLabel,
      dateKey: selectedDayKey,
    }));
    printWindow.document.close();
    window.setTimeout(() => {
      if (printWindow.closed) return;
      printWindow.focus();
      printWindow.print();
    }, 250);
  };

  return (
    <div className="space-y-8">
      {/* ---------------- SLIDE 3: EL AGENTE: PANEL DE CONTROL DIARIO ---------------- */}
      <section id="inicio" className="glass-panel rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-2">
              <span>Operación · {currentMonthLabel} · {agent.name} ({agent.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'})</span>
              {agent.pbxExtension && (
                <span className="font-mono text-[11px] text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/40">
                  PBX: {agent.pbxExtension}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Resumen de gestión</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>Mes</span>
              <select
                value={selectedMonthKey}
                onChange={(event) => selectMonth(event.target.value)}
                className="px-3 py-2 rounded-xl glass-input bg-slate-900 text-slate-100 capitalize"
                aria-label="Mes de la agenda y el resumen"
              >
                {monthOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>Periodo</span>
              <select
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(event.target.value as 'hoy' | 'semana' | 'mes')}
                className="px-3 py-2 rounded-xl glass-input bg-slate-900 text-slate-100"
                aria-label="Periodo del resumen"
              >
                <option value="hoy">{selectedDayKey === todayKey ? 'Hoy' : 'Día seleccionado'}</option>
                <option value="semana">{selectedMonthKey === currentMonthKey ? 'Esta semana' : 'Semana del día seleccionado'}</option>
                <option value="mes">{selectedMonthKey === currentMonthKey ? 'Este mes' : currentMonthLabel}</option>
              </select>
            </label>
          </div>

          {/* Export Dropdown Button matching Slide 3 exactly */}
          <div className="relative">
            <button
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 text-slate-100 text-xs font-semibold border border-slate-700/80 shadow-lg shadow-black/30 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-blue-400" />
              <span>Descargar Excel: Reporte Diario / Acuerdos / No Contactados</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </button>

            {isExportMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-30">
                <button
                  onClick={() => handleExportXLSX('diario')}
                  className="w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2.5"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="font-semibold">Reporte Diario Completo</div>
                    <div className="text-[11px] text-slate-400 group-hover:text-blue-100">
                      Exporta todos los {filteredClients.length} clientes asignados
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => handleExportXLSX('acuerdos')}
                  className="w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <div>
                    <div className="font-semibold">Acuerdos y Pagos Cerrados</div>
                    <div className="text-[11px] text-slate-400">Clientes con gestión resuelta</div>
                  </div>
                </button>
                <button
                  onClick={() => handleExportXLSX('no_contactados')}
                  className="w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="font-semibold">No Contactados / Pendientes</div>
                    <div className="text-[11px] text-slate-400">Clientes que requieren reintento</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {(!monthlyStateLoaded || monthlyStateError) && (
          <div className="mb-4 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {monthlyStateError || 'Consultando la bitácora confirmada en Supabase… La agenda no se mostrará como pendiente hasta terminar.'}
          </div>
        )}

        {/* 3 Metric Cards + Circular Ring */}
        <div id="mi-cartera" className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Card 1: agenda for the selected day, not the full portfolio */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">1</span>
            <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">
                {selectedDayKey === todayKey ? 'Pendientes de hoy:' : 'Pendientes del día seleccionado:'}
              </div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">{todayPendingSlots}</div>
            </div>
          </div>

          {/* Card 2: Gestiones registradas en el periodo */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">2</span>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">
                Gestiones {selectedPeriod === 'hoy'
                  ? selectedDayKey === todayKey ? 'de hoy' : 'del día seleccionado'
                  : selectedPeriod === 'semana' ? 'de la semana' : 'del mes'}:
              </div>
                <div className="text-2xl font-bold font-mono text-white tabular-nums">
                  {monthlyStateLoaded ? summaryProgressCount : '—'}
                </div>
            </div>
          </div>

          {/* Card 3: Clientes con gestión en el periodo */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">3</span>
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">Clientes con gestión en el periodo:</div>
                <div className="text-2xl font-bold font-mono text-white tabular-nums">
                  {monthlyStateLoaded ? summaryClientCount : '—'}
                </div>
            </div>
          </div>

          {/* Card 4: avance real contra la meta configurada */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center justify-between gap-3 border border-purple-500/30 bg-gradient-to-br from-purple-950/30 via-slate-900/90 to-slate-900 relative overflow-hidden">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">
                  {selectedPeriod === 'mes'
                    ? 'Efectividad de cartera'
                    : `Progreso ${selectedPeriod === 'hoy'
                      ? selectedDayKey === todayKey ? 'de hoy' : 'del día seleccionado'
                      : 'de la semana'}`}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                  {monthlyStateLoaded ? summaryProgressLabel : 'Verificando bitácora'}
                </span>
              </div>
              <div className="text-3xl font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-pink-300 to-emerald-400 tabular-nums">
                {!monthlyStateLoaded
                  ? '—'
                  : selectedPeriod === 'mes' || summaryGoal > 0
                    ? `${summaryProgress}%`
                    : '—'}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {monthlyStateLoaded ? summaryProgressDescription : 'Esperando lectura confirmada desde Supabase.'}
              </div>
            </div>

            <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-slate-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-purple-400"
                  strokeDasharray={`${Math.min(100, summaryProgress)}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute text-[10px] font-bold text-purple-300">
                {summaryGoal > 0 && summaryProgress >= 100 ? '✓' : '↗'}
              </div>
            </div>
          </div>
        </div>

        {/* Charts Row: Tasa de contacto & Tasa de acuerdos (Slide 3) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-800/80">
          {/* Chart 1: Tasa de contacto */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Gestiones registradas esta semana</h3>
                <div className="text-[11px] text-slate-400 mt-0.5">Conteo de registros con fecha real</div>
              </div>
              <span className="text-[11px] font-mono text-blue-400 font-medium">
                {weeklyRecordCounts.reduce((sum, count) => sum + count, 0)} gestiones
              </span>
            </div>
            
            {/* SVG Line Chart for Mon-Fri */}
            <div className="h-40 w-full relative">
              <svg className="w-full h-full" viewBox="0 0 400 120" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="contactGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Grid lines */}
                <line x1="0" y1="10" x2="400" y2="10" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="45" x2="400" y2="45" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="80" x2="400" y2="80" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="110" x2="400" y2="110" stroke="#334155" strokeWidth="0.8" />
                
                {/* Area and Line */}
                <path
                  d={contactAreaPath}
                  fill="url(#contactGradient)"
                />
                <path
                  d={contactLinePath}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                />
                
                {/* Data points */}
                {dailyContactStats.map((d) => (
                  <circle
                    key={d.day}
                    cx={d.x}
                    cy={d.y}
                    r={d.count > 0 ? 5 : 3.5}
                    fill={d.count > 0 ? '#60a5fa' : '#475569'}
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            </div>
            
            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-6">
              {dailyContactStats.map((d) => (
                <span key={d.day} className={d.count > 0 ? 'text-blue-400 font-bold' : ''}>
                  {d.day} ({d.count})
                </span>
              ))}
            </div>
          </div>

          {/* Chart 2: Tasa de acuerdos (esta semana) */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Promesas y acuerdos esta semana</h3>
                <div className="text-[11px] text-slate-400 mt-0.5">Conteo de gestiones con acuerdo registrado</div>
              </div>
              <span className="text-[11px] font-mono text-amber-400 font-medium">{totalWeeklyAgreements} acuerdos</span>
            </div>

            {/* SVG Line Chart for Agreements */}
            <div className="h-40 w-full relative">
              <svg className="w-full h-full" viewBox="0 0 400 120" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="agreeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Grid lines */}
                <line x1="0" y1="10" x2="400" y2="10" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="45" x2="400" y2="45" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="80" x2="400" y2="80" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="110" x2="400" y2="110" stroke="#334155" strokeWidth="0.8" />
                
                {/* Area and Line */}
                <path
                  d={agreementAreaPath}
                  fill="url(#agreeGradient)"
                />
                <path
                  d={agreementLinePath}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2.5"
                />
                
                {/* Data points */}
                {dailyAgreementStats.map((d) => (
                  <circle
                    key={d.day}
                    cx={d.x}
                    cy={d.y}
                    r={d.count > 0 ? 5 : 3.5}
                    fill={d.count > 0 ? '#fbbf24' : '#475569'}
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            </div>

            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-6">
              {dailyAgreementStats.map((d) => (
                <span key={d.day} className={d.count > 0 ? 'text-amber-400 font-bold' : ''}>
                  {d.day} ({d.count})
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- NAVIGATION TABS: LISTA DE GESTIÓN DIARIA VS MI CARTERA ---------------- */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-2 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('lista-gestion')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'lista-gestion'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            <span>{readOnly ? 'Gestión diaria del agente' : 'Mi Lista de Gestión Diaria (Días 1 al 22)'}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-900/60 text-blue-200 border border-blue-700/50 font-mono">
              {clientsPerDay}/día
            </span>
          </button>

          {!readOnly && (
          <button
            type="button"
            onClick={() => setActiveTab('mi-cartera')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'mi-cartera'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>Mi Cartera Completa (General)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
              {agentClients.length}
            </span>
          </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono w-full sm:w-auto justify-end px-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Agenda optimizada Días 1 al 22</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: MI LISTA DE GESTIÓN DIARIA (DIVIDIDA EN LOS DÍAS 1 AL 22 DEL MES) */}
      {/* ========================================================================= */}
      {activeTab === 'lista-gestion' && (
        <section id="lista-gestion" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-blue-900/60 text-blue-300 border border-blue-700/50">
                  {currentMonthLabel}
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Lista de Gestión Diaria</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-800/60 text-emerald-400 font-semibold font-mono">
                    {clientsPerDay} Clientes/Día
                  </span>
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 max-w-3xl leading-relaxed">
                Del día 1 al 22 se listan clientes con al menos una factura emitida el mes anterior. Los que solo tienen facturas del mes actual aparecerán el próximo mes; hoy y los días ya trabajados se conservan sin cambios. Se programan hasta {clientsPerDay} llamadas por día, sin duplicar clientes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportDailyXLSX}
                disabled={displayedDaySlots.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors border border-emerald-800 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Excel del día
              </button>
              <button
                type="button"
                onClick={handlePrintDailyPdf}
                disabled={displayedDaySlots.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer className="w-3.5 h-3.5" />
                PDF del día
              </button>
              <button
                type="button"
                onClick={() => selectDayForSummary(todayParts.day)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  selectedDayOfMonth === todayParts.day
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/25'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Ir a Hoy ({todayParts.day} {new Intl.DateTimeFormat('es-SV', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(todayParts.year, todayParts.month - 1, 15, 12))).replace(/\./g, '')})
              </button>
            </div>
          </div>

          {/* Daily KPIs Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Día de Gestión</span>
              <div className="text-lg font-black font-mono text-white mt-1">
                {activeDayPlan?.dateStr || `${String(selectedDayOfMonth).padStart(2, '0')} ${currentMonthShort}`}
                <span className="text-xs text-blue-400 font-normal">({activeDayPlan?.weekdayName || selectedWeekdayLabel})</span>
              </div>
              <span className="text-[11px] text-slate-400">
                Día {selectedDayOfMonth} del mes
                {!activeDayPlan && <span className="text-amber-300"> · Fuera del ciclo operativo (1–22)</span>}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Agenda del día seleccionado</span>
              <div className="text-lg font-black font-mono text-blue-400 mt-1">
                {monthlyStateLoaded ? displayedDaySlots.length : '—'} <span className="text-xs text-slate-400 font-normal">
                  {displayedDaySlots.length === 1 ? 'cliente' : 'clientes'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                <span className="text-emerald-300 font-semibold">{monthlyStateLoaded ? todayResolvedSlots : '—'} gestionados</span>
                {' · '}
                <span className="text-blue-300 font-semibold">{monthlyStateLoaded ? todayPendingSlots : '—'} pendientes</span>
                {activeDayPlan && (
                  <>
                    {' · '}
                    <span className={activeDayPlan.criticalCount > 0 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                      {activeDayPlan.criticalCount > 0 ? `${activeDayPlan.criticalCount} llamadas críticas` : 'Mora controlada'}
                    </span>
                    {activeDayPlan.followUpCount > 0 && (
                      <span className="text-amber-300 font-semibold"> · {activeDayPlan.followUpCount} seguimientos por mora</span>
                    )}
                  </>
                )}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Monto a Cobrar del Día Seleccionado</span>
              <div className="text-lg font-black font-mono text-emerald-400 mt-1">
                {activeDayPlan
                  ? activeDayPlan.clients.every((c) => c.debtVerified === false)
                    ? 'Pendiente SAN'
                    : `$${activeDayPlan.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </div>
              <span className="text-[11px] text-slate-400">
                 {activeDayPlan
                   ? activeDayPlan.clients.every((c) => c.debtVerified === false)
                     ? 'Saldo pendiente de sincronizar'
                     : 'Suma de saldos SAP verificados'
                   : 'Sin monto de agenda'}
              </span>
            </div>

            {/* Card 4: Progreso de Hoy con Porcentaje Grande en la Esquina (Rendimiento del Agente) */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-purple-950/50 via-slate-900/90 to-slate-900 border border-purple-500/40 shadow-lg shadow-purple-950/25 relative overflow-hidden flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-purple-300 uppercase tracking-wider font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                  Progreso del día seleccionado
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  todayDailyPct >= 100
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-600/60'
                    : todayDailyPct >= 50
                    ? 'bg-blue-950 text-blue-300 border-blue-600/60'
                    : 'bg-purple-950 text-purple-300 border-purple-700/60'
                }`}>
                  Rendimiento
                </span>
              </div>

              {/* PORCENTAJE GRANDE EN LA ESQUINA */}
              <div className="flex items-baseline justify-between mt-1.5">
                <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-300 to-emerald-400">
                  {monthlyStateLoaded && activeDayPlan ? `${todayDailyPct}%` : '—'}
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-bold text-white">
                    {!monthlyStateLoaded
                      ? '—'
                      : activeDayPlan
                      ? <>{todayResolvedSlots} <span className="text-slate-400 font-normal">/ {todayGoal}</span></>
                      : <>{todayResolvedSlots} <span className="text-slate-400 font-normal">registradas</span></>}
                  </span>
                  <span className="block text-[10px] text-slate-400">gestiones</span>
                </div>
              </div>

              {/* Barra de progreso */}
              <div className="mt-2 space-y-1">
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    style={{ width: `${activeDayPlan ? Math.min(100, Math.max(0, todayDailyPct)) : 0}%` }}
                    className={`h-full rounded-full transition-all duration-500 ${
                      todayDailyPct >= 100
                        ? 'bg-emerald-400'
                        : todayDailyPct >= 50
                        ? 'bg-blue-400'
                        : 'bg-gradient-to-r from-purple-400 to-pink-400'
                    }`}
                  ></div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>{!monthlyStateLoaded ? 'Verificando bitácora' : activeDayPlan ? `${todayPendingSlots} restantes` : 'Sin agenda operativa'}</span>
                  <span className="text-purple-300 font-semibold">
                    {!monthlyStateLoaded
                      ? '—'
                      : activeDayPlan
                      ? todayDailyPct >= 100 ? 'Meta cumplida' : `${(100 - todayDailyPct).toFixed(1)}% pendiente`
                      : 'No aplica'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Horizontal Scrollable Calendar Day Picker (22 Days strictly) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                Seleccionar Día del Mes (Días 1 al 22):
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectDayForSummary(Math.max(1, selectedDayOfMonth - 1))}
                  disabled={selectedDayOfMonth === 1}
                  className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Día anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-white font-bold">Día {selectedDayOfMonth} / {daysInMonth}</span>
                <button
                  type="button"
                  onClick={() => selectDayForSummary(Math.min(daysInMonth, selectedDayOfMonth + 1))}
                  disabled={selectedDayOfMonth === daysInMonth}
                  className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Día siguiente"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto pb-2 pt-1 flex items-center gap-2 no-scrollbar">
              {daysDistribution.map((day) => {
                const isSelected = selectedDayOfMonth === day.dayNumber;
                const hasCritical = day.criticalCount > 0;
                return (
                  <button
                    key={day.dayNumber}
                    type="button"
                    onClick={() => selectDayForSummary(day.dayNumber)}
                    disabled={!monthlyStateLoaded}
                    className={`shrink-0 flex flex-col items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer min-w-[76px] ${
                      isSelected
                        ? 'bg-gradient-to-b from-blue-600 to-indigo-700 text-white border-blue-400 shadow-lg shadow-blue-500/30 scale-105 z-10'
                        : hasCritical
                        ? 'bg-slate-900/90 text-slate-300 border-red-900/50 hover:border-red-700 hover:bg-slate-800'
                        : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      {day.weekdayName}
                    </span>
                    <span className="text-base font-black font-mono my-0.5">
                      {day.dayNumber}
                    </span>
                    <span className="text-[10px] font-mono opacity-80">
                      {day.dateStr}
                    </span>

                    <div className="mt-1 pt-1 border-t border-white/10 w-full flex items-center justify-center gap-1 text-[9px] font-bold font-mono">
                      {hasCritical && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" title="Contiene clientes críticos" />
                      )}
                      <span>{monthlyStateLoaded ? `${day.slots.length} pend.` : '—'}</span>
                      {monthlyStateLoaded && day.managedCount > 0 && (
                        <span className="text-emerald-300">· {day.managedCount} gest.</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Daily Table Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={`Buscar en llamadas del día ${selectedDayOfMonth}...`}
                value={dailySearchTerm}
                onChange={(e) => setDailySearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl glass-input placeholder:text-slate-500 font-medium"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={dailyStateFilter}
                onChange={(e) => setDailyStateFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl glass-input font-medium"
              >
                <option value="TODOS" className="bg-slate-900">Estado (Todos)</option>
                <option value="Pendiente" className="bg-slate-900">Pendiente</option>
                <option value="Gestionado" className="bg-slate-900">Gestionado</option>
              </select>

              <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                {filteredDailySlots.length} de {displayedDaySlots.length} clientes del día
              </span>
            </div>
          </div>

          {/* Daily Prioritized Table with Call Rounds (e.g. 1ª, 2ª Llamada) */}
          <div className="overflow-x-auto overflow-y-auto max-h-[560px] rounded-xl border border-slate-800 shadow-inner">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-800 shadow-sm">
                <tr>
                  <th className="py-3.5 px-3 text-center font-mono w-24"># Turno / Hora</th>
                  <th className="py-3.5 px-3 font-mono">Cód. Cliente</th>
                  <th className="py-3.5 px-4">Nombre del Cliente (SAP)</th>
                  <th className="py-3.5 px-3 text-center">Ronda / Seguimiento</th>
                  <th className="py-3.5 px-3 text-center">Urgencia / Mora</th>
                  <th className="py-3.5 px-4 text-right">Monto a Cobrar</th>
                  <th className="py-3.5 px-4">Contacto / Teléfono</th>
                  <th className="py-3.5 px-3">Gestor Comercial</th>
                  <th className="py-3.5 px-3 text-center">Estado</th>
                  <th className="py-3.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredDailySlots.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-500">
              {!monthlyStateLoaded
                ? 'La lista está oculta hasta confirmar el estado de cada gestión desde Supabase.'
                : !activeDayPlan
                        ? `El día ${selectedDayOfMonth} está fuera de la ventana operativa del 1 al 22; no hay agenda planificada.`
                        : 'No se encontraron llamadas para este día con los filtros seleccionados.'}
                    </td>
                  </tr>
                ) : (
                  filteredDailySlots.map((slot, idx) => {
                    const client = slot.client;
                    const dailyGestion = findSlotGestion(slot);
                    const isResolved = Boolean(dailyGestion);
                    const displayedState = dailyGestion ? 'Gestionado' : 'Pendiente';
                    const isCritical = client.daysArrears >= 90;

                    return (
                      <tr
                        key={`${client.code}-day${selectedDayOfMonth}-${idx}`}
                        className={`hover:bg-slate-800/40 transition-colors group ${
                          isResolved ? 'bg-emerald-950/10' : isCritical ? 'bg-red-950/15' : ''
                        }`}
                      >
                        {/* Turno y Hora */}
                        <td className="py-3.5 px-3 text-center font-mono font-bold whitespace-nowrap">
                          <span className="text-white block">#{slot.turnNumber}</span>
                          <span className="text-[10px] text-blue-400 font-normal">{slot.timeSlot}</span>
                        </td>

                        {/* Cód. Cliente */}
                        <td className="py-3.5 px-3 font-mono font-bold text-blue-400 whitespace-nowrap">
                          <span className="px-2 py-1 rounded bg-blue-950/70 border border-blue-800/60">
                            {client.code}
                          </span>
                        </td>

                        {/* Nombre del Cliente */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col max-w-xs sm:max-w-md">
                            <span className="font-semibold text-slate-100 group-hover:text-blue-300 transition-colors line-clamp-1">
                              {client.name}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono truncate">
                              {client.department} · {client.municipality}
                            </span>
                          </div>
                        </td>

                        {/* Ronda de Llamada (e.g. 1ª Llamada, 2ª Llamada) */}
                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono border ${
                              slot.callRound === 3
                                ? 'bg-red-950/90 text-red-200 border-red-700/70'
                                : slot.callRound === 2
                                ? 'bg-amber-950/90 text-amber-200 border-amber-700/70'
                                : 'bg-blue-950/90 text-blue-200 border-blue-700/70'
                            }`}
                          >
                            {slot.callRoundLabel || `${slot.callRound}ª Llamada`}
                          </span>
                        </td>

                        {/* Urgencia / Días de Mora */}
                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${
                              client.daysArrears > 120
                                ? 'bg-red-950/80 text-red-300 border-red-700/60 shadow-sm shadow-red-900/40'
                                : client.daysArrears > 60
                                ? 'bg-amber-950/80 text-amber-300 border-amber-700/60 shadow-sm shadow-amber-900/40'
                                : client.daysArrears > 30
                                ? 'bg-orange-950/80 text-orange-300 border-orange-700/60 shadow-sm shadow-orange-900/40'
                                : 'bg-blue-950/80 text-blue-300 border-blue-700/60 shadow-sm shadow-blue-900/40'
                            }`}
                          >
                            {client.debtVerified === false ? 'Pendiente SAN' : `${client.daysArrears} días`}
                          </span>
                        </td>

                        {/* Monto */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-100 tabular-nums whitespace-nowrap">
                          {client.debtVerified === false
                            ? 'Pendiente SAN'
                            : `${currentCountry === 'GT' ? 'Q' : '$'}${client.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </td>

                        {/* Contacto / Teléfono */}
                        <td className="py-3.5 px-4 text-slate-300 font-mono whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{client.phone1 || client.celular || 'Sin teléfono'}</span>
                            {(client.phone1 || client.celular) && (
                              <a
                                href={`tel:${client.phone1 || client.celular}`}
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-400 transition-colors"
                                title="Llamar"
                              >
                                <PhoneCall className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </td>

                        {/* Gestor Comercial */}
                        <td className="py-3.5 px-3 text-slate-300 whitespace-nowrap">
                          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                            {client.salesManager || 'Gestor RED'}
                          </span>
                        </td>

                        {/* Estado */}
                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                              isResolved
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                                : 'bg-blue-950/70 text-blue-300 border border-blue-800/60'
                            }`}
                          >
                            {displayedState}
                          </span>
                        </td>

                        {/* Acción */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {dailyGestion ? (
                            <button
                              type="button"
                              onClick={() => setViewingGestion(dailyGestion)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver gestión
                            </button>
                          ) : readOnly ? (
                            <button
                              type="button"
                              disabled
                              className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 bg-slate-800 border border-slate-700 cursor-not-allowed"
                            >
                              Pendiente
                            </button>
                          ) : (
                            <button
                              onClick={() => openGestionForClient(client)}
                              className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
                            >
                              Gestionar Cliente
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: MI CARTERA COMPLETA (TABLA GENERAL DE TODOS LOS CLIENTES) */}
      {/* ========================================================================= */}
      {activeTab === 'mi-cartera' && (
        <section id="mi-cartera" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-blue-900/60 text-blue-300 border border-blue-700/50">
                  {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-white">Mi Cartera Completa (General)</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 max-w-3xl">
                Visualización integral de todos los clientes asignados en la cartera. Permite búsquedas globales, filtros detallados por rango de mora y exportación oficial a Excel.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <span>Mostrando:</span>
                <span className="text-white font-bold">{filteredClients.length}</span>
                <span>de {agentClients.length} clientes</span>
              </div>

              {/* Export menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <span>Exportar Excel</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {isExportMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl bg-slate-900 border border-slate-800 shadow-xl z-20 py-1 text-xs">
                    <button
                      type="button"
                      onClick={() => handleExportXLSX('diario')}
                      className="w-full text-left px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      Exportar Cartera Actual
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportXLSX('acuerdos')}
                      className="w-full text-left px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      Exportar Acuerdos Resueltos
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportXLSX('no_contactados')}
                      className="w-full text-left px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      Exportar No Contactados
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Filter controls row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search box */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar cliente, código o teléfono..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl glass-input placeholder:text-slate-500 font-medium"
              />
            </div>

            {/* Rango de Mora filter */}
            <div className="relative">
              <select
                value={selectedRangeFilter}
                onChange={(e) => onSelectRange(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input appearance-none cursor-pointer font-medium"
              >
                <option value="TODOS" className="bg-slate-900">Filtrar por: Rango de Mora (Todos)</option>
                <option value="0-30" className="bg-slate-900">0-30 días (No moroso)</option>
                <option value="31-60" className="bg-slate-900">31-60 días (Primer contacto)</option>
                <option value="61-90" className="bg-slate-900">61-90 días (Segundo contacto)</option>
                <option value="91-120" className="bg-slate-900">91-120 días (Tercer contacto)</option>
                <option value="120+" className="bg-slate-900">120+ días (Crítico)</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Estado de Gestión filter */}
            <div className="relative">
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input appearance-none cursor-pointer font-medium"
              >
                <option value="TODOS" className="bg-slate-900">Estado de cartera (Todos)</option>
                <option value="Pendiente" className="bg-slate-900">Pendiente de pago</option>
                <option value="No Contactado" className="bg-slate-900">No Contactado</option>
                <option value="Contactado" className="bg-slate-900">Contactado</option>
                <option value="Reprogramado" className="bg-slate-900">Reprogramado</option>
                <option value="Resuelto" className="bg-slate-900">Resuelto</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Prioridad filter */}
            <div className="relative">
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input appearance-none cursor-pointer font-medium"
              >
                <option value="TODOS" className="bg-slate-900">Prioridad (Todas)</option>
                <option value="Alta" className="bg-slate-900">Prioridad Alta</option>
                <option value="Media" className="bg-slate-900">Prioridad Media</option>
                <option value="Normal" className="bg-slate-900">Prioridad Normal</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Full Cartera Table */}
          <div className="overflow-x-auto overflow-y-auto max-h-[640px] rounded-xl border border-slate-800 shadow-inner">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-800 shadow-sm">
                <tr>
                  <th className="py-3.5 px-4 font-mono">Cód. Cliente</th>
                  <th className="py-3.5 px-4">Nombre del Cliente (SAP)</th>
                  <th className="py-3.5 px-4 text-center">Días de Mora</th>
                  <th className="py-3.5 px-4 text-right">Monto Total</th>
                  <th className="py-3.5 px-4">Contacto / Teléfono</th>
                  <th className="py-3.5 px-4">Gestor Comercial</th>
                  <th className="py-3.5 px-4">Estado de cartera</th>
                  <th className="py-3.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      No se encontraron clientes con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client) => {
                    const latestManagement = latestManagementByClient.get(
                      `${client.country}:${client.code.trim().toUpperCase()}`,
                    );
                    const scheduledDate = getClientGestionDate(client);
                    const scheduledDayManagement = getManagementForClientDate(client, scheduledDate);
                    const managementToday = selectedMonthKey === currentMonthKey
                      ? getManagementForClientDate(client, todayKey)
                      : undefined;
                    const gestionToView = scheduledDayManagement || managementToday || latestManagement;
                    const alreadyManagedForAction = Boolean(gestionToView);
                    return (
                      <React.Fragment key={client.code}>
                      <tr className="hover:bg-slate-800/40 transition-colors group">
                        {/* Cód. Cliente */}
                        <td className="py-3.5 px-4 font-mono font-bold text-blue-400 whitespace-nowrap">
                          <span className="px-2 py-1 rounded bg-blue-950/70 border border-blue-800/60">
                            {client.code}
                          </span>
                        </td>

                        {/* Nombre del Cliente */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col max-w-xs sm:max-w-md">
                            <span className="font-semibold text-slate-100 group-hover:text-blue-300 transition-colors line-clamp-1">
                              {client.name}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono truncate">
                              {client.department} · {client.municipality}
                            </span>
                          </div>
                        </td>

                        {/* Días de Mora */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-bold font-mono border ${
                              client.daysArrears > 120
                                ? 'bg-red-950/80 text-red-300 border-red-700/60 shadow-sm shadow-red-900/40'
                                : client.daysArrears > 60
                                ? 'bg-amber-950/80 text-amber-300 border-amber-700/60 shadow-sm shadow-amber-900/40'
                                : client.daysArrears > 30
                                ? 'bg-orange-950/80 text-orange-300 border-orange-700/60 shadow-sm shadow-orange-900/40'
                                : 'bg-blue-950/80 text-blue-300 border-blue-700/60 shadow-sm shadow-blue-900/40'
                            }`}
                          >
                            {client.debtVerified === false ? 'Pendiente SAN' : `${client.daysArrears} días`}
                          </span>
                        </td>

                        {/* Monto */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-100 tabular-nums whitespace-nowrap">
                          {client.debtVerified === false
                            ? 'Pendiente SAN'
                            : `$${client.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </td>

                        {/* Contacto / Teléfono */}
                        <td className="py-3.5 px-4 text-slate-300 font-mono whitespace-nowrap">
                          <div className="flex flex-col">
                            <span>{client.phone1 || client.celular || 'Sin teléfono'}</span>
                            {client.phone2 && (
                              <span className="text-[10px] text-slate-500">{client.phone2}</span>
                            )}
                          </div>
                        </td>

                        {/* Gestor Comercial */}
                        <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">
                          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                            {client.salesManager || 'Gestor RED'}
                          </span>
                        </td>

                        {/* Estado de cartera y última gestión */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                                client.state === 'Resuelto'
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                                  : client.state === 'No Contactado'
                                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                  : 'bg-blue-950/70 text-blue-300 border border-blue-800/60'
                              }`}
                            >
                              {client.state === 'Pendiente' ? 'Pendiente de pago' : client.state}
                            </span>
                            {gestionToView && (
                              <span
                                className="text-[10px] font-medium text-emerald-300"
                                title={`${gestionToView.channel} · ${gestionToView.time}`}
                              >
                                Gestión: {gestionToView.date}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Acción */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              aria-expanded={expandedHistoryClientCode === client.code}
                              onClick={() => setExpandedHistoryClientCode((current) => current === client.code ? '' : client.code)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-200 bg-blue-950/60 border border-blue-800/60 hover:bg-blue-900/70 transition-colors"
                            >
                              <History className="w-3.5 h-3.5" />
                              Historial
                            </button>
                            {gestionToView && (
                              <button
                                type="button"
                                onClick={() => setViewingGestion(gestionToView)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-200 bg-emerald-950/70 border border-emerald-800/60 hover:bg-emerald-900/70 transition-colors cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Ver gestión
                              </button>
                            )}
                            {!alreadyManagedForAction && (
                              <button
                                onClick={() => openGestionForClient(client)}
                                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
                              >
                                Gestionar Cliente
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedHistoryClientCode === client.code && (
                        <tr>
                          <td colSpan={8} className="p-3">
                            <ClientManagementHistory client={client} onViewRecord={setViewingGestion} />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {viewingGestion && (
        <GestionReadOnlyModal
          record={viewingGestion}
          client={clients.find((client) => client.code === viewingGestion.clientCode && client.country === viewingGestion.country)}
          dynamicFields={dynamicFields}
          onClose={() => setViewingGestion(null)}
          onEdit={!readOnly
            && !viewingGestion.isSharedManagement
            && viewingGestion.agentId === agent.id
            && onEditSavedGestion
            ? () => {
                const client = clients.find((item) =>
                  item.code === viewingGestion.clientCode && item.country === viewingGestion.country
                );
                if (client) onEditSavedGestion(viewingGestion, client);
                setViewingGestion(null);
              }
            : undefined}
          onOpenPaymentEvidence={readOnly ? onOpenPaymentEvidence : undefined}
        />
      )}
    </div>
  );
};
