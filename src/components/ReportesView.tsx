import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Client, Country, Agent, GestionAuditRecord, isClientAssignedToAgent } from '../types';
import { authenticatedApiFetch } from '../services/authService';
import { getElSalvadorDateKey, getManagementScheduledDateKey, isCountableManagement } from '../utils/gestionDates';
import { sumMonthlyRecoveredAmount } from '../utils/monthlyRecovery';
import {
  BriefcaseBusiness,
  BarChart3,
  TrendingUp,
  FileSpreadsheet,
  FileText,
  Calendar,
  Filter,
  CheckCircle2,
  Clock,
  CircleDollarSign,
  Users,
  Award,
  ArrowUpRight,
  Download,
  Printer,
} from 'lucide-react';

interface ReportesViewProps {
  currentCountry: Country;
  clients: Client[];
  agents: Agent[];
  isAdmin?: boolean;
}

export const ReportesView: React.FC<ReportesViewProps> = ({
  currentCountry,
  clients,
  agents,
  isAdmin = false,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<'mes' | 'semana' | 'dia'>('mes');
  const monthKey = getElSalvadorDateKey().slice(0, 7);
  const [monthlyStates, setMonthlyStates] = useState<Array<{ codigo_cliente: string; estado: string; monto_recuperado: number | string | null }> | null>(null);
  const [auditRecords, setAuditRecords] = useState<GestionAuditRecord[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await authenticatedApiFetch(
          `/api/cartera?action=estado-mensual&pais=${encodeURIComponent(currentCountry)}&mes=${monthKey}`,
          { cache: 'no-store' },
        );
        const payload = await response.json().catch(() => ({}));
        if (active && response.ok && payload.success && Array.isArray(payload.states)) {
          setMonthlyStates(payload.states.filter((state: any) =>
            state.mes_periodo === monthKey && state.estado === 'Resuelto'
          ));
        }
      } catch {
        // Keep the last loaded snapshot.
      }
      if (!isAdmin) return;
      try {
        const response = await authenticatedApiFetch(
          `/api/admin/agentes?action=gestiones&pais=${encodeURIComponent(currentCountry)}`,
          { cache: 'no-store' },
        );
        const payload = await response.json().catch(() => ({}));
        if (active && response.ok && payload.success && Array.isArray(payload.records)) {
          setAuditRecords(payload.records as GestionAuditRecord[]);
        }
      } catch {
        // Keep the last loaded snapshot.
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [currentCountry, isAdmin, monthKey]);

  const resolvedCodes = useMemo(() => new Set(
    (monthlyStates || []).map((state) => String(state.codigo_cliente || '').trim().toUpperCase()),
  ), [monthlyStates]);
  const recoveredByCode = useMemo(() => new Map(
    (monthlyStates || []).map((state) => [
      String(state.codigo_cliente || '').trim().toUpperCase(),
      sumMonthlyRecoveredAmount([state]),
    ]),
  ), [monthlyStates]);
  const managedCodesByAgent = useMemo(() => {
    const byAgent = new Map<string, Set<string>>();
    (auditRecords || []).forEach((record) => {
      if (!isCountableManagement(record)) return;
      if (getManagementScheduledDateKey(record)?.slice(0, 7) !== monthKey) return;
      const codes = byAgent.get(record.agentId) || new Set<string>();
      codes.add(record.clientCode.trim().toUpperCase());
      byAgent.set(record.agentId, codes);
    });
    return byAgent;
  }, [auditRecords, monthKey]);
  const managedCodes = useMemo(
    () => new Set([...managedCodesByAgent.values()].flatMap((codes) => [...codes])),
    [managedCodesByAgent],
  );

  // Filter clients by country
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      // Exclude inactive
      const s = String(c.estatus || c.status || '').toUpperCase();
      if (s.includes('INACT') || s.includes('BAJA') || s.includes('CANCEL') || s.includes('SUSPEND') || s === 'NO ACTIVO') {
        return false;
      }
      if (c.country !== currentCountry) {
        return false;
      }
      return true;
    });
  }, [clients, currentCountry]);

  // General KPIs: "al día" = paid this month in SAN or no verified overdue days.
  const isUpToDate = (c: Client) =>
    resolvedCodes.has(c.code.trim().toUpperCase())
    || (c.debtVerified !== false && Number(c.daysArrears) <= 0)
    || (monthlyStates === null && c.state === 'Resuelto');
  const isManaged = (c: Client) => managedCodes.has(c.code.trim().toUpperCase());
  const recoveredFor = (list: Client[]) =>
    list.reduce((sum, c) => sum + (recoveredByCode.get(c.code.trim().toUpperCase()) || 0), 0);
  const totalClients = filteredClients.length;
  const managedClients = filteredClients.filter(isUpToDate);
  const pendingClients = filteredClients.filter((c) => !isUpToDate(c));
  const verifiedDebtClients = filteredClients.filter((c) => c.debtVerified !== false);
  const totalDebt = verifiedDebtClients.reduce((sum, c) => sum + (c.totalDebt || 0), 0);
  const totalRecovered = sumMonthlyRecoveredAmount(monthlyStates || []);
  const recoveryRate = totalDebt + totalRecovered > 0
    ? ((totalRecovered / (totalDebt + totalRecovered)) * 100).toFixed(1)
    : '0.0';
  const operationalRate = totalClients > 0 ? ((managedClients.length / totalClients) * 100).toFixed(1) : '0.0';
  const managedThisMonthCount = filteredClients.filter(isManaged).length;

  // Aging Buckets breakdown
  const buckets = ['0-30', '31-60', '61-90', '91-120', '120+'] as const;
  const bucketStats = buckets.map((range) => {
    const bucketClients = verifiedDebtClients.filter((c) => c.moraRange === range);
    const count = bucketClients.length;
    const debt = bucketClients.reduce((sum, c) => sum + (c.totalDebt || 0), 0);
    const resolved = bucketClients.filter(isUpToDate);
    const resolvedDebt = recoveredFor(resolved);
    const rate = count > 0 ? ((resolved.length / count) * 100).toFixed(1) : '0.0';
    return {
      range,
      count,
      debt,
      resolvedCount: resolved.length,
      resolvedDebt,
      rate: Number(rate),
    };
  });

  // Agent Performance Ranking
  const countryAgents = agents.filter((a) => {
    if (a.role !== 'agente') return false;
    if (a.country !== currentCountry) return false;
    return true;
  });

  const agentRankings = countryAgents.map((ag) => {
    const agClients = filteredClients.filter((c) => isClientAssignedToAgent(c, ag.id));
    const agTotal = agClients.length;
    const agManaged = agClients.filter(isUpToDate).length;
    const agPending = agTotal - agManaged;
    const agRecovered = recoveredFor(agClients);
    const agentManagedCodes = managedCodesByAgent.get(ag.id) || new Set<string>();
    const agWorked = agClients.filter((c) => agentManagedCodes.has(c.code.trim().toUpperCase())).length;
    const agDebt = agClients.filter((c) => c.debtVerified !== false).reduce((sum, c) => sum + (c.totalDebt || 0), 0);
    const agRate = agTotal > 0 ? Number(((agManaged / agTotal) * 100).toFixed(1)) : 0.0;

    return {
      agent: ag,
      totalAssigned: agTotal,
      managed: agManaged,
      pending: agPending,
      recovered: agRecovered,
      worked: agWorked,
      totalDebt: agDebt,
      rate: agRate,
    };
  }).sort((a, b) => b.rate - a.rate);

  // Outcome Breakdown
  const outcomes = [
    { label: 'Al día / pagado este mes', count: managedClients.length, color: 'text-emerald-400' },
    { label: 'Gestionados este mes (cualquier medio)', count: managedThisMonthCount, color: 'text-blue-400' },
    { label: 'Pendientes de pago', count: pendingClients.length, color: 'text-amber-400' },
    { label: 'Sin gestión este mes', count: filteredClients.filter((c) => !isManaged(c) && !isUpToDate(c)).length, color: 'text-red-400' },
  ];

  const handleExportExecutiveExcel = () => {
    const headers = [
      'Código Cliente',
      'Cliente',
      'País',
      'Rango Mora',
      'Días Mora',
      'Deuda Total',
      'Estado',
      'Prioridad',
      'Agente Asignado',
      'Última Gestión',
    ];

    const rows = filteredClients.map((c) => [
      c.code,
      c.name,
      c.country === 'SV' ? 'El Salvador' : 'Guatemala',
      c.debtVerified === false ? 'Pendiente de consultar en SAN' : c.moraRange,
      c.debtVerified === false ? 'Pendiente de consultar en SAN' : c.daysArrears,
      c.debtVerified === false ? 'Pendiente de consultar en SAN' : c.totalDebt,
      c.state,
      c.priority || 'Normal',
      c.assignedAgentName || 'Sin asignar',
      c.lastManagementDate || 'Sin registro',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 35 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 22 },
      { wch: 18 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cartera Consolidada');
    XLSX.writeFile(wb, `Reporte_Ejecutivo_Cobranza_${currentCountry}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handlePrintPDF = () => {
    window.print();
  };

  const currencySymbol = currentCountry === 'GT' ? 'Q' : '$';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-widest mb-1.5">
            <BriefcaseBusiness className="w-4 h-4 text-blue-400" />
            <span>Centro de Analítica & Rendimiento Financiero · RED</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Informes y Reportes Operativos
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Visión del desempeño de recuperación de cartera, cumplimiento de metas por gestor y evolución de morosidad en {currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportExecutiveExcel}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Exportar Excel</span>
          </button>

          <button
            onClick={handlePrintPDF}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4 text-slate-300" />
            <span>Imprimir PDF</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Cartera Total Bajo Gestión</span>
            <CircleDollarSign className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black font-mono text-white mt-2 tabular-nums">
            {verifiedDebtClients.length === 0
              ? 'Pendiente SAN'
              : `${currencySymbol}${totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            {totalClients} clientes activos
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Monto Recuperado (mes)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-400 mt-2 tabular-nums">
            {currencySymbol}{totalRecovered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-emerald-400/90 mt-1 font-mono">
            {recoveryRate}% de lo cobrable · {managedClients.length} clientes al día
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Efectividad Operativa Real</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black font-mono text-blue-300 mt-2 tabular-nums">
            {operationalRate}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            {managedClients.length} de {totalClients} al día · {managedThisMonthCount} gestionados
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Cuentas Pendientes</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-400 mt-2 tabular-nums">
            {pendingClients.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            Con saldo vencido por cobrar
          </div>
        </div>
      </div>

      {/* Grid: Aging Buckets Analysis & Agent Performance Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Matriz de Morosidad por Fases */}
        <div className="lg:col-span-7 glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                Matriz de Morosidad por Tramos (Aging Buckets)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Comportamiento de la deuda y nivel de resolución por tramo de vencimiento
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {bucketStats.map((b) => (
              <div key={b.range} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-3 h-3 rounded-full ${
                        b.range === '0-30'
                          ? 'bg-blue-500'
                          : b.range === '31-60'
                          ? 'bg-orange-400'
                          : b.range === '61-90'
                          ? 'bg-yellow-500'
                          : b.range === '91-120'
                          ? 'bg-orange-600'
                          : 'bg-red-500'
                      }`}
                    />
                    <span className="font-bold text-white">{b.range} días</span>
                    <span className="text-[11px] text-slate-400 font-mono">({b.count} clientes)</span>
                  </div>

                  <div className="text-right font-mono">
                    <span className="font-bold text-white tabular-nums">
                      {currencySymbol}{b.debt.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-slate-400 text-[11px] ml-2 font-normal">
                      · Al día: <strong className="text-emerald-400">{b.rate}%</strong>
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(0, b.rate))}%` }}
                    className={`h-full transition-all duration-500 ${
                      b.rate > 70 ? 'bg-emerald-500' : b.rate > 30 ? 'bg-blue-500' : 'bg-amber-500'
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Ranking de Rendimiento de Gestores */}
        <div className="lg:col-span-5 glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                Desempeño por Gestor de Cobranza
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Ranking de efectividad y monto recuperado
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {agentRankings.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No hay gestores asignados para el país seleccionado.
              </div>
            ) : (
              agentRankings.map((item, idx) => (
                <div
                  key={item.agent.id}
                  className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        src={item.agent.avatarUrl}
                        alt={item.agent.name}
                        className="w-10 h-10 rounded-full object-cover border border-slate-700"
                      />
                      <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300 flex items-center justify-center">
                        {idx + 1}
                      </span>
                    </div>

                    <div>
                      <div className="text-xs font-bold text-white truncate max-w-[140px] sm:max-w-xs">
                        {item.agent.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        PBX: {item.agent.pbxExtension || '—'} · {item.managed} de {item.totalAssigned} al día · {item.worked} gestionados
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-mono font-black text-emerald-400 tabular-nums">
                      {item.rate.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {currencySymbol}{item.recovered.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Outcome Distribution Summary */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-4">
          Resumen de Estados de Gestión
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {outcomes.map((o) => (
            <div key={o.label} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">{o.label}</div>
              <div className={`text-2xl font-black font-mono mt-1 ${o.color}`}>
                {o.count}
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                {totalClients > 0 ? ((o.count / totalClients) * 100).toFixed(1) : 0}% del universo
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
