import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Agent, Client, Country, ManagementState, MoraRange, Priority } from '../types';
import { MORA_PHASES } from '../utils/moraLogic';
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
} from 'lucide-react';

interface AgentDashboardProps {
  currentCountry: Country;
  agent: Agent;
  clients: Client[];
  onOpenGestionModal: (client: Client) => void;
  selectedRangeFilter: MoraRange | 'TODOS';
  onSelectRange: (range: MoraRange | 'TODOS') => void;
  activeModule?: string;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  currentCountry,
  agent,
  clients,
  onOpenGestionModal,
  selectedRangeFilter,
  onSelectRange,
  activeModule,
}) => {
  const [activeTab, setActiveTab] = useState<'lista-gestion' | 'mi-cartera'>('lista-gestion');
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number>(1);
  const [dailySearchTerm, setDailySearchTerm] = useState<string>('');
  const [dailyStateFilter, setDailyStateFilter] = useState<string>('TODOS');

  const [stateFilter, setStateFilter] = useState<string>('TODOS');
  const [priorityFilter, setPriorityFilter] = useState<string>('TODOS');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    if (activeModule === 'mi-cartera') {
      setActiveTab('mi-cartera');
    } else if (activeModule === 'lista-gestion') {
      setActiveTab('lista-gestion');
    }
  }, [activeModule]);

  // Filter clients assigned to this agent and matching active filters
  const agentClients = clients
    .filter((c) => c.country === currentCountry && (!c.assignedAgentId || c.assignedAgentId === agent.id))
    .sort((a, b) => b.daysArrears - a.daysArrears);

  const totalAssigned = agentClients.length;
  const managedCount = agentClients.filter((c) => c.state === 'Resuelto').length;
  const pendingCount = agentClients.filter((c) => c.state === 'Pendiente' || c.state === 'No Contactado').length;
  const completionPercentage = totalAssigned > 0 ? Math.round((managedCount / totalAssigned) * 100) : 0;

  // Real Week Days Calculation for Contacts & Agreements
  const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
  const dailyQuota = Math.max(1, Math.round(totalAssigned / 5));

  const dailyContactStats = weekDays.map((day, idx) => {
    const dayClients = agentClients.filter((c) => {
      if (!c.lastManagementDate) return false;
      return c.lastManagementDate.toLowerCase().includes(day.toLowerCase());
    });
    // Rate is based on actual contacts made on that day vs daily quota
    const rate = Math.round((dayClients.length / dailyQuota) * 100);
    const x = 40 + idx * 80;
    const y = 110 - (Math.min(100, Math.max(0, rate)) / 100) * 75;
    return { day, count: dayClients.length, rate, x, y };
  });

  const dailyAgreementStats = weekDays.map((day, idx) => {
    const dayAgreements = agentClients.filter((c) => {
      if (c.state !== 'Resuelto' || !c.lastManagementDate) return false;
      return c.lastManagementDate.toLowerCase().includes(day.toLowerCase());
    });
    const rate = Math.round((dayAgreements.length / dailyQuota) * 100);
    const x = 40 + idx * 80;
    const y = 110 - (Math.min(100, Math.max(0, rate)) / 100) * 75;
    return { day, count: dayAgreements.length, rate, x, y };
  });

  const contactLinePath = dailyContactStats.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.x} ${d.y}`).join(' ');
  const contactAreaPath = `${contactLinePath} L 360 110 L 40 110 Z`;

  const agreementLinePath = dailyAgreementStats.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.x} ${d.y}`).join(' ');
  const agreementAreaPath = `${agreementLinePath} L 360 110 L 40 110 Z`;

  const avgAgreementRate = Math.round(
    dailyAgreementStats.reduce((sum, d) => sum + d.rate, 0) / dailyAgreementStats.length
  );

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

  // Distribute across 31 days of October 2026:
  const daysInMonth = 31;
  const daysDistribution = useMemo(() => {
    const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const days: Array<{
      dayNumber: number;
      dateStr: string;
      weekdayName: string;
      clients: Client[];
      totalDebt: number;
      resolvedDebt: number;
      criticalCount: number;
      resolvedCount: number;
    }> = [];

    // Initialize 31 days of October 2026
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(2026, 9, d); // Oct 1, 2026 is Thursday
      const wDayName = weekdays[dt.getDay()];
      days.push({
        dayNumber: d,
        dateStr: `${String(d).padStart(2, '0')} Oct`,
        weekdayName: wDayName,
        clients: [],
        totalDebt: 0,
        resolvedDebt: 0,
        criticalCount: 0,
        resolvedCount: 0,
      });
    }

    // Partition prioritized clients across the 31 days:
    // With ~388 clients, each day gets ~12-13 clients.
    // Days 1-5 receive the most critical clients (120+ days with highest debt),
    // followed by 91-120, 61-90, 31-60, and 0-30 days reminders.
    const batchSize = Math.ceil(prioritizedClients.length / daysInMonth) || 1;
    prioritizedClients.forEach((client, idx) => {
      const targetDayIndex = Math.min(Math.floor(idx / batchSize), daysInMonth - 1);
      const dayObj = days[targetDayIndex];
      dayObj.clients.push(client);
      dayObj.totalDebt += client.totalDebt || 0;
      if (client.state === 'Resuelto') {
        dayObj.resolvedDebt += client.totalDebt || 0;
        dayObj.resolvedCount += 1;
      }
      if (client.daysArrears >= 90) {
        dayObj.criticalCount += 1;
      }
    });

    return days;
  }, [prioritizedClients]);

  const activeDayPlan = daysDistribution[selectedDayOfMonth - 1] || daysDistribution[0];

  // Filtered daily clients for the selected day
  const filteredDailyClients = activeDayPlan.clients.filter((c) => {
    if (dailyStateFilter !== 'TODOS' && c.state !== dailyStateFilter) return false;
    if (dailySearchTerm.trim()) {
      const q = dailySearchTerm.toLowerCase();
      const matchName = c.name?.toLowerCase().includes(q);
      const matchCode = c.code?.toLowerCase().includes(q);
      const matchPhone = c.phone1?.toLowerCase().includes(q) || c.celular?.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchPhone) return false;
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
            <h2 className="text-2xl font-bold tracking-tight text-white">Resumen del Día</h2>
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

          {/* Card 2: Gestionados */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">2</span>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">Gestionados:</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">{managedCount}</div>
            </div>
          </div>

          {/* Card 3: Pendientes */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center gap-4 relative overflow-hidden border border-slate-800">
            <span className="absolute top-2 left-3 text-[10px] font-mono text-slate-500 font-bold">3</span>
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-400">Pendientes:</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">{pendingCount}</div>
            </div>
          </div>

          {/* Card 4: Circular Progress Ring (Slide 3: 75% Completado) */}
          <div className="glass-panel-subtle rounded-xl p-4 flex items-center justify-center gap-4 border border-blue-500/20 bg-blue-950/20">
            <div className="relative w-18 h-18 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-slate-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-blue-500"
                  strokeDasharray={`${completionPercentage}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-xs text-blue-400 font-bold">↗</span>
              </div>
            </div>
            <div>
              <div className="text-2xl font-extrabold font-mono text-white tabular-nums">
                {completionPercentage}%
              </div>
              <div className="text-xs font-medium text-slate-300">Completado</div>
            </div>
          </div>
        </div>

        {/* Charts Row: Tasa de contacto & Tasa de acuerdos (Slide 3) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-800/80">
          {/* Chart 1: Tasa de contacto */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Tasa de contacto</h3>
                <div className="text-[11px] text-slate-400 mt-0.5">Gestiones realizadas por día de la semana (100% Real)</div>
              </div>
              <span className="text-[11px] font-mono text-blue-400 font-medium">Meta: 30%</span>
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
                    r={d.rate > 0 ? 5 : 3.5}
                    fill={d.rate > 0 ? '#60a5fa' : '#475569'}
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            </div>
            
            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-6">
              {dailyContactStats.map((d) => (
                <span key={d.day} className={d.rate > 0 ? 'text-blue-400 font-bold' : ''}>
                  {d.day} ({d.rate}%)
                </span>
              ))}
            </div>
          </div>

          {/* Chart 2: Tasa de acuerdos (esta semana) */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Tasa de acuerdos (esta semana)</h3>
                <div className="text-[11px] text-slate-400 mt-0.5">Acuerdos y pagos cerrados por día (100% Real)</div>
              </div>
              <span className="text-[11px] font-mono text-amber-400 font-medium">Promedio: {avgAgreementRate}%</span>
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
                    r={d.rate > 0 ? 5 : 3.5}
                    fill={d.rate > 0 ? '#fbbf24' : '#475569'}
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            </div>

            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-6">
              {dailyAgreementStats.map((d) => (
                <span key={d.day} className={d.rate > 0 ? 'text-amber-400 font-bold' : ''}>
                  {d.day} ({d.rate}%)
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
            <span>Mi Lista de Gestión Diaria (Plan del Mes)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-900/60 text-blue-200 border border-blue-700/50 font-mono">
              31 Días
            </span>
          </button>

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
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono w-full sm:w-auto justify-end px-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Cartera sincronizada con SAP ERP</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: MI LISTA DE GESTIÓN DIARIA (DIVIDIDA EN LOS 31 DÍAS DEL MES) */}
      {/* ========================================================================= */}
      {activeTab === 'lista-gestion' && (
        <section id="lista-gestion" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-blue-900/60 text-blue-300 border border-blue-700/50">
                  Octubre 2026
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Lista de Gestión Diaria</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-800/60 text-emerald-400 font-semibold font-mono">
                    Priorizado por Urgencia
                  </span>
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 max-w-3xl leading-relaxed">
                Toda la cartera de clientes dividida estratégicamente en los 31 días del mes. Se programan primero los clientes más críticos y con mayor monto de mora (120+ y 91-120 días) para recordarles el pago de inmediato, seguido de las demás moras y facturas del corte.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedDayOfMonth(1)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  selectedDayOfMonth === 1
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/25'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Ir a Hoy (Día 1)
              </button>
            </div>
          </div>

          {/* Daily KPIs Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Día de Gestión</span>
              <div className="text-lg font-black font-mono text-white mt-1">
                {activeDayPlan.dateStr} <span className="text-xs text-blue-400 font-normal">({activeDayPlan.weekdayName})</span>
              </div>
              <span className="text-[11px] text-slate-400">Día {activeDayPlan.dayNumber} de 31</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Clientes para Hoy</span>
              <div className="text-lg font-black font-mono text-blue-400 mt-1">
                {activeDayPlan.clients.length} <span className="text-xs text-slate-400 font-normal">asignados</span>
              </div>
              <span className="text-[11px] text-slate-400">
                {activeDayPlan.criticalCount > 0 ? (
                  <span className="text-red-400 font-semibold">{activeDayPlan.criticalCount} críticos</span>
                ) : (
                  'Mora controlada'
                )}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Monto a Cobrar Hoy</span>
              <div className="text-lg font-black font-mono text-emerald-400 mt-1">
                ${activeDayPlan.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <span className="text-[11px] text-slate-400">Meta del turno</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Progreso de Hoy</span>
              <div className="text-lg font-black font-mono text-purple-400 mt-1">
                {activeDayPlan.resolvedCount} de {activeDayPlan.clients.length}
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1.5 overflow-hidden">
                <div
                  style={{
                    width: `${activeDayPlan.clients.length > 0 ? Math.round((activeDayPlan.resolvedCount / activeDayPlan.clients.length) * 100) : 0}%`,
                  }}
                  className="bg-emerald-500 h-full rounded-full transition-all"
                ></div>
              </div>
            </div>
          </div>

          {/* Horizontal Scrollable Calendar Day Picker (31 Days) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-400" />
                Seleccionar Día del Mes (Octubre 2026):
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDayOfMonth((prev) => Math.max(1, prev - 1))}
                  disabled={selectedDayOfMonth === 1}
                  className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Día anterior"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-white font-bold">Día {selectedDayOfMonth} / 31</span>
                <button
                  type="button"
                  onClick={() => setSelectedDayOfMonth((prev) => Math.min(daysInMonth, prev + 1))}
                  disabled={selectedDayOfMonth === daysInMonth}
                  className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
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
                const isCompleted = day.clients.length > 0 && day.resolvedCount === day.clients.length;

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
                      <span>{day.clients.length} c.</span>
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
                placeholder={`Buscar en clientes del día ${selectedDayOfMonth}...`}
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
                {filteredDailyClients.length} de {activeDayPlan.clients.length} clientes del día
              </span>
            </div>
          </div>

          {/* Daily Prioritized Table */}
          <div className="overflow-x-auto overflow-y-auto max-h-[560px] rounded-xl border border-slate-800 shadow-inner">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-800 shadow-sm">
                <tr>
                  <th className="py-3.5 px-3 text-center font-mono w-14"># Turno</th>
                  <th className="py-3.5 px-4 font-mono">Cód. Cliente</th>
                  <th className="py-3.5 px-4">Nombre del Cliente (SAP)</th>
                  <th className="py-3.5 px-4 text-center">Urgencia / Mora</th>
                  <th className="py-3.5 px-4 text-right">Monto a Cobrar</th>
                  <th className="py-3.5 px-4">Contacto / Teléfono</th>
                  <th className="py-3.5 px-4">Gestor Comercial</th>
                  <th className="py-3.5 px-4">Estado</th>
                  <th className="py-3.5 px-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {filteredDailyClients.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500">
                      No se encontraron clientes para este día con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredDailyClients.map((client, idx) => {
                    const isResolved = client.state === 'Resuelto';
                    const isCritical = client.daysArrears >= 90;

                    return (
                      <tr
                        key={client.code}
                        className={`hover:bg-slate-800/40 transition-colors group ${
                          isResolved ? 'bg-emerald-950/10' : isCritical ? 'bg-red-950/15' : ''
                        }`}
                      >
                        {/* Turno */}
                        <td className="py-3.5 px-3 text-center font-mono font-bold text-slate-400">
                          #{idx + 1}
                        </td>

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

                        {/* Urgencia / Días de Mora */}
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
                            {client.daysArrears} días ({client.moraRange})
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
    </div>
  );
};
