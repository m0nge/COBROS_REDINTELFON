import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Agent, Client, Country, GestionAuditRecord, ManagementState, MoraRange, Priority } from '../types';
import { MORA_PHASES, buildWorkloadSchedule1To22, ScheduledCallSlot, OPERATIONAL_DAYS_MAX } from '../utils/moraLogic';
import {
  formatMonthLabel,
  getElSalvadorDateKey,
  getElSalvadorDateParts,
  getRecordDateKey,
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
  X,
} from 'lucide-react';

interface AgentDashboardProps {
  currentCountry: Country;
  agent: Agent;
  clients: Client[];
  onOpenGestionModal: (client: Client) => void;
  selectedRangeFilter: MoraRange | 'TODOS';
  onSelectRange: (range: MoraRange | 'TODOS') => void;
  activeModule?: string;
  clientsPerDay?: number;
  auditLog?: GestionAuditRecord[];
  readOnly?: boolean;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  currentCountry,
  agent,
  clients,
  onOpenGestionModal,
  selectedRangeFilter,
  onSelectRange,
  activeModule,
  clientsPerDay = 40,
  auditLog = [],
  readOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState<'lista-gestion' | 'mi-cartera' | 'metricas'>('lista-gestion');
  const [now, setNow] = useState<Date>(() => new Date());
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number>(() => getElSalvadorDateParts().day);
  const [selectedPeriod, setSelectedPeriod] = useState<'hoy' | 'semana' | 'mes'>('hoy');
  const [viewingGestion, setViewingGestion] = useState<GestionAuditRecord | null>(null);
  const [dailySearchTerm, setDailySearchTerm] = useState<string>('');
  const [dailyStateFilter, setDailyStateFilter] = useState<string>('TODOS');

  const [stateFilter, setStateFilter] = useState<string>('TODOS');
  const [priorityFilter, setPriorityFilter] = useState<string>('TODOS');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const todayParts = getElSalvadorDateParts(now);
  const todayKey = getElSalvadorDateKey(now);
  const currentMonthKey = todayKey.slice(0, 7);
  const currentWeekStartKey = getWeekStartDateKey(todayKey);
  const currentMonthLabel = formatMonthLabel(todayParts.year, todayParts.month);
  const currentMonthShort = new Intl.DateTimeFormat('es-SV', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(todayParts.year, todayParts.month - 1, 15, 12))).replace(/\./g, '');
  const selectedWeekdayLabel = new Intl.DateTimeFormat('es-SV', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(todayParts.year, todayParts.month - 1, selectedDayOfMonth, 12)));

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    setSelectedDayOfMonth(todayParts.day);
  }, [todayParts.day, todayParts.month, todayParts.year]);

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
      return c.assignedAgentId === agent.id;
    })
    .sort((a, b) => b.daysArrears - a.daysArrears);

  const totalAssigned = agentClients.length;
  const agentAuditRecords = auditLog.filter((record) => {
    if (record.country !== agent.country) return false;
    if (record.agentId) return record.agentId === agent.id;
    return (record.agentName || '').trim().toLocaleLowerCase() === agent.name.trim().toLocaleLowerCase();
  });
  const periodAuditRecords = agentAuditRecords.filter((record) => {
    const recordDateKey = getRecordDateKey(record);
    if (!recordDateKey || recordDateKey > todayKey) return false;
    if (selectedPeriod === 'hoy') return recordDateKey === todayKey;
    if (selectedPeriod === 'semana') return recordDateKey >= currentWeekStartKey;
    return recordDateKey.slice(0, 7) === currentMonthKey;
  });
  const periodClientCount = new Set(periodAuditRecords.map((record) => record.clientCode)).size;
  const operationalDaysInWeek = Array.from({ length: 7 }, (_, index) => shiftDateKey(currentWeekStartKey, index))
    .filter((dateKey) => dateKey <= todayKey)
    .filter((dateKey) => Number(dateKey.slice(8, 10)) <= OPERATIONAL_DAYS_MAX)
    .length;
  const effectiveDailyGoal = Math.min(clientsPerDay, totalAssigned);
  const periodGoal = selectedPeriod === 'hoy'
    ? (todayParts.day <= OPERATIONAL_DAYS_MAX ? effectiveDailyGoal : 0)
    : selectedPeriod === 'semana'
      ? effectiveDailyGoal * operationalDaysInWeek
      : effectiveDailyGoal * Math.min(todayParts.day, OPERATIONAL_DAYS_MAX);
  const periodProgress = periodGoal > 0 ? Number(((periodAuditRecords.length / periodGoal) * 100).toFixed(1)) : 0;

  const weekDateKeys = Array.from({ length: 7 }, (_, index) => shiftDateKey(currentWeekStartKey, index));
  const weekDays = weekDateKeys.map((dateKey) => {
    const weekday = new Intl.DateTimeFormat('es-SV', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${dateKey}T12:00:00Z`));
    return weekday.replace(/\./g, '').slice(0, 3);
  });
  const weeklyRecordCounts = weekDateKeys.map((dateKey) =>
    dateKey > todayKey
      ? 0
      : agentAuditRecords.filter((record) => getRecordDateKey(record) === dateKey).length
  );
  const weeklyAgreementCounts = weekDateKeys.map((dateKey) =>
    dateKey > todayKey
      ? 0
      : agentAuditRecords.filter((record) => {
      if (getRecordDateKey(record) !== dateKey) return false;
      const agreement = (record.agreement || '').toLocaleLowerCase();
      return agreement.includes('promesa') || agreement.includes('negociación');
      }).length
  );
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
    return [...agentClients].sort((a, b) => {
      // Pending first before resolved
      const aResolved = a.state === 'Resuelto' ? 1 : 0;
      const bResolved = b.state === 'Resuelto' ? 1 : 0;
      if (aResolved !== bResolved) return aResolved - bResolved;

      // Higher mora range weight first
      const wA = moraUrgencyWeight[a.moraRange] || 0;
      const wB = moraUrgencyWeight[b.moraRange] || 0;
      if (wA !== wB) return wB - wA;

      // More days arrears first
      if (b.daysArrears !== a.daysArrears) return b.daysArrears - a.daysArrears;

      // Higher debt first
      return (b.totalDebt || 0) - (a.totalDebt || 0);
    });
  }, [agentClients]);

  // The operational schedule is planned for days 1 to 22 of the current month.
  const daysInMonth = OPERATIONAL_DAYS_MAX; // 22

  const workloadSchedule = useMemo(() => {
    return buildWorkloadSchedule1To22(prioritizedClients, clientsPerDay);
  }, [prioritizedClients, clientsPerDay]);

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
    }> = [];

    // Initialize the current month's 22 operational days.
    for (let d = 1; d <= OPERATIONAL_DAYS_MAX; d++) {
      const dt = new Date(Date.UTC(todayParts.year, todayParts.month - 1, d, 12));
      const wDayName = weekdays[dt.getUTCDay()];
      const daySlots = workloadSchedule[d] || [];
      const dayClients = daySlots.map((s) => s.client);
      const totalDebt = dayClients.reduce((sum, c) => sum + (c.totalDebt || 0), 0);
      const resolvedDebt = dayClients
        .filter((c) => c.state === 'Resuelto')
        .reduce((sum, c) => sum + (c.totalDebt || 0), 0);
      const criticalCount = dayClients.filter((c) => c.daysArrears >= 90).length;
      const resolvedCount = dayClients.filter((c) => c.state === 'Resuelto').length;

      days.push({
        dayNumber: d,
        dateKey: toDateKey(todayParts.year, todayParts.month, d),
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
      });
    }

    return days;
  }, [workloadSchedule, todayParts.year, todayParts.month]);

  const activeDayPlan = daysDistribution.find((day) => day.dayNumber === selectedDayOfMonth);
  const selectedDayKey = toDateKey(todayParts.year, todayParts.month, selectedDayOfMonth);
  const selectedDayRecords = agentAuditRecords.filter((record) => getRecordDateKey(record) === selectedDayKey);
  const displayedDaySlots: ScheduledCallSlot[] = activeDayPlan?.slots || (readOnly
    ? selectedDayRecords.flatMap((record, index) => {
        const client = agentClients.find((candidate) => candidate.code === record.clientCode);
        if (!client) return [];
        return [{
          client,
          scheduledDay: selectedDayOfMonth,
          callRound: 1,
          callRoundLabel: record.callRoundLabel || 'Gestión registrada',
          turnNumber: index + 1,
          timeSlot: record.time || '',
        }];
      })
    : []);
  const todayTotalSlots = activeDayPlan?.slots?.length || 0;
  const todayResolvedSlots = selectedDayRecords.length;
  const todayDailyPct = todayTotalSlots > 0 ? Number(((todayResolvedSlots / todayTotalSlots) * 100).toFixed(1)) : 0.0;

  const findSlotGestion = (slot: ScheduledCallSlot) => {
    const clientRecords = selectedDayRecords.filter((record) => record.clientCode === slot.client.code);
    return clientRecords.find((record) =>
      record.callRoundLabel && slot.callRoundLabel && record.callRoundLabel === slot.callRoundLabel
    ) || clientRecords[0];
  };

  // Filtered daily slots for the selected day
  const filteredDailySlots = displayedDaySlots.filter((slot) => {
    const c = slot.client;
    const isRegistered = Boolean(findSlotGestion(slot));
    const rowState = readOnly ? (isRegistered ? 'Resuelto' : 'Pendiente') : c.state;
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
    if (selectedRangeFilter !== 'TODOS' && c.moraRange !== selectedRangeFilter) return false;
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
      Number(c.daysArrears || 0),
      c.moraRange || '0-30',
      Number(c.totalDebt || 0),
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

  return (
    <div className="space-y-8">
      {/* ---------------- SLIDE 3: EL AGENTE: PANEL DE CONTROL DIARIO ---------------- */}
      <section id="inicio" className="glass-panel rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-2">
              <span>Operación del Día · {agent.name} ({agent.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'})</span>
              {agent.pbxExtension && (
                <span className="font-mono text-[11px] text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/40">
                  PBX: {agent.pbxExtension}
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Resumen de gestión</h2>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span>Periodo</span>
            <select
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(event.target.value as 'hoy' | 'semana' | 'mes')}
              className="px-3 py-2 rounded-xl glass-input bg-slate-900 text-slate-100"
              aria-label="Periodo del resumen"
            >
              <option value="hoy">Hoy</option>
              <option value="semana">Esta semana</option>
              <option value="mes">Este mes</option>
            </select>
          </label>

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

        {/* 3 Metric Cards + Circular Ring */}
        <div id="mi-cartera" className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Card 1: Total Asignados */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">1</span>
            <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">Total Asignados:</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">{totalAssigned}</div>
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
                Gestiones {selectedPeriod === 'hoy' ? 'de hoy' : selectedPeriod === 'semana' ? 'de la semana' : 'del mes'}:
              </div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">{periodAuditRecords.length}</div>
            </div>
          </div>

          {/* Card 3: Clientes con gestión en el periodo */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">3</span>
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">Clientes con gestión:</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">{periodClientCount}</div>
            </div>
          </div>

          {/* Card 4: avance real contra la meta configurada */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center justify-between gap-3 border border-purple-500/30 bg-gradient-to-br from-purple-950/30 via-slate-900/90 to-slate-900 relative overflow-hidden">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">
                  Progreso {selectedPeriod === 'hoy' ? 'de hoy' : selectedPeriod === 'semana' ? 'de la semana' : 'del mes'}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                  {periodGoal > 0 ? `${periodAuditRecords.length} / ${periodGoal}` : 'Sin meta operativa'}
                </span>
              </div>
              <div className="text-3xl font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-pink-300 to-emerald-400 tabular-nums">
                {periodGoal > 0 ? `${periodProgress}%` : '—'}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {periodGoal > 0
                  ? `Meta configurada: ${periodGoal} gestiones`
                  : 'Fuera de la ventana operativa del 1 al 22'}
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
                  strokeDasharray={`${Math.min(100, periodProgress)}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute text-[10px] font-bold text-purple-300">
                {periodGoal > 0 && periodProgress >= 100 ? '✓' : '↗'}
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
                Toda la cartera de clientes dividida estrictamente del día 1 al 22 del mes ({clientsPerDay} llamadas al día). Se programan llamadas múltiples a clientes con mora (1ª, 2ª y 3ª llamada) asegurando que el cliente pague su factura del mes antes del corte.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedDayOfMonth(todayParts.day)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  selectedDayOfMonth === todayParts.day
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/25'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Ir a Hoy ({todayParts.day} {currentMonthShort})
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
                {displayedDaySlots.length} <span className="text-xs text-slate-400 font-normal">
                  {activeDayPlan ? 'turnos' : 'gestiones registradas'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                {activeDayPlan ? activeDayPlan.criticalCount > 0 ? (
                  <span className="text-red-400 font-semibold">{activeDayPlan.criticalCount} llamadas críticas</span>
                ) : (
                  'Mora controlada'
                ) : 'No hay agenda planificada para esta fecha'}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Monto a Cobrar Hoy</span>
              <div className="text-lg font-black font-mono text-emerald-400 mt-1">
                {activeDayPlan
                  ? `$${activeDayPlan.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </div>
              <span className="text-[11px] text-slate-400">
                {activeDayPlan ? 'Total de la agenda' : 'Sin monto de agenda'}
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
                  {activeDayPlan ? `${todayDailyPct}%` : '—'}
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-bold text-white">
                    {activeDayPlan
                      ? <>{todayResolvedSlots} <span className="text-slate-400 font-normal">/ {todayTotalSlots}</span></>
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
                  <span>{activeDayPlan ? `${Math.max(0, todayTotalSlots - todayResolvedSlots)} restantes` : 'Sin agenda operativa'}</span>
                  <span className="text-purple-300 font-semibold">
                    {activeDayPlan
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
                  onClick={() => setSelectedDayOfMonth((prev) => Math.max(1, prev - 1))}
                  disabled={selectedDayOfMonth === 1}
                  className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Día anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-white font-bold">Día {selectedDayOfMonth} / 22</span>
                <button
                  type="button"
                  onClick={() => setSelectedDayOfMonth((prev) => Math.min(daysInMonth, prev + 1))}
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
                    onClick={() => setSelectedDayOfMonth(day.dayNumber)}
                    className={`shrink-0 flex flex-col items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer min-w-[76px] ${
                      isSelected
                        ? 'bg-gradient-to-b from-blue-600 to-indigo-700 text-white border-blue-400 shadow-lg shadow-blue-500/30 scale-105 z-10'
                        : hasCritical
                        ? 'bg-slate-900/90 text-slate-300 border-red-900/50 hover:border-red-700 hover:bg-slate-800'
                        : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                    }`}
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
                      <span>{day.slots.length} c.</span>
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
                <option value="No Contactado" className="bg-slate-900">No Contactado</option>
                <option value="Resuelto" className="bg-slate-900">Resuelto</option>
              </select>

              <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                {filteredDailySlots.length} de {displayedDaySlots.length} llamadas del día
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
                      {!activeDayPlan
                        ? `El día ${selectedDayOfMonth} está fuera de la ventana operativa del 1 al 22; no hay agenda planificada.`
                        : 'No se encontraron llamadas para este día con los filtros seleccionados.'}
                    </td>
                  </tr>
                ) : (
                  filteredDailySlots.map((slot, idx) => {
                    const client = slot.client;
                    const dailyGestion = findSlotGestion(slot);
                    const isResolved = readOnly ? Boolean(dailyGestion) : client.state === 'Resuelto';
                    const displayedState = readOnly ? (dailyGestion ? 'Gestionado' : 'Pendiente') : client.state;
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
                            {client.daysArrears} días
                          </span>
                        </td>

                        {/* Monto */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-100 tabular-nums whitespace-nowrap">
                          ${client.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                : displayedState === 'No Contactado'
                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                : 'bg-blue-950/70 text-blue-300 border border-blue-800/60'
                            }`}
                          >
                            {displayedState}
                          </span>
                        </td>

                        {/* Acción */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {readOnly ? (
                            dailyGestion ? (
                              <button
                                type="button"
                                onClick={() => setViewingGestion(dailyGestion)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 transition-colors cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Ver gestión
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 bg-slate-800 border border-slate-700 cursor-not-allowed"
                              >
                                Pendiente
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => onOpenGestionModal(client)}
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
                <option value="TODOS" className="bg-slate-900">Estado de Gestión (Todos)</option>
                <option value="Pendiente" className="bg-slate-900">Pendiente</option>
                <option value="No Contactado" className="bg-slate-900">No Contactado</option>
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
                  <th className="py-3.5 px-4">Estado</th>
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
                    return (
                      <tr
                        key={client.code}
                        className="hover:bg-slate-800/40 transition-colors group"
                      >
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
                            {client.daysArrears} días
                          </span>
                        </td>

                        {/* Monto */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-100 tabular-nums whitespace-nowrap">
                          ${client.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

                        {/* Estado */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                              client.state === 'Resuelto'
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                                : client.state === 'No Contactado'
                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                : 'bg-blue-950/70 text-blue-300 border border-blue-800/60'
                            }`}
                          >
                            {client.state}
                          </span>
                        </td>

                        {/* Acción */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => onOpenGestionModal(client)}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
                          >
                            Gestionar Cliente
                          </button>
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
      {viewingGestion && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="gestion-readonly-title"
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950 p-5">
              <div>
                <div className="text-xs uppercase tracking-wider text-emerald-300">Gestión registrada · Solo lectura</div>
                <h2 id="gestion-readonly-title" className="mt-1 text-xl font-bold text-white">
                  {viewingGestion.clientName}
                </h2>
                <div className="mt-1 font-mono text-xs text-slate-400">
                  {viewingGestion.clientCode} · {viewingGestion.date} {viewingGestion.time}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingGestion(null)}
                aria-label="Cerrar detalle de gestión"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {[
                ['Canal', viewingGestion.channel],
                ['Ronda', viewingGestion.callRoundLabel],
                ['Contacto', viewingGestion.contactSuccess],
                ['Acuerdo', viewingGestion.agreement],
                ['Monto comprometido', viewingGestion.committedAmount === undefined ? undefined : `$${viewingGestion.committedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
                ['Fecha compromiso', viewingGestion.deadlineDate],
                ['Duración', viewingGestion.durationSeconds === undefined ? undefined : `${viewingGestion.durationSeconds} segundos`],
                ['Evaluación registrada', viewingGestion.aiVerdict],
                ['Puntaje registrado', viewingGestion.aiScore],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
                  <div className="mt-1 break-words text-sm font-medium text-slate-100">
                    {value === undefined || value === null || value === '' ? 'No registrado' : value}
                  </div>
                </div>
              ))}
              <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Campos adicionales</div>
                {Object.entries(viewingGestion.dynamicValues || {}).length > 0 ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {Object.entries(viewingGestion.dynamicValues || {}).map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-slate-950/70 p-2">
                        <div className="text-[10px] text-slate-500">{label}</div>
                        <div className="mt-1 break-words text-sm text-slate-100">
                          {value === undefined || value === null || value === ''
                            ? 'No registrado'
                            : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">No se guardaron campos adicionales en esta gestión.</p>
                )}
              </div>
              <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Observaciones</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">
                  {viewingGestion.observations || 'No registradas'}
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
