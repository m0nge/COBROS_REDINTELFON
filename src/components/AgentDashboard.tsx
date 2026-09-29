import React, { useState } from 'react';
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
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
} from 'lucide-react';

interface AgentDashboardProps {
  currentCountry: Country;
  agent: Agent;
  clients: Client[];
  onOpenGestionModal: (client: Client) => void;
  selectedRangeFilter: MoraRange | 'TODOS';
  onSelectRange: (range: MoraRange | 'TODOS') => void;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({
  currentCountry,
  agent,
  clients,
  onOpenGestionModal,
  selectedRangeFilter,
  onSelectRange,
}) => {
  const [stateFilter, setStateFilter] = useState<string>('TODOS');
  const [priorityFilter, setPriorityFilter] = useState<string>('TODOS');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);

  // Filter clients assigned to this agent and matching active filters
  const agentClients = clients.filter(
    (c) => c.country === currentCountry && (!c.assignedAgentId || c.assignedAgentId === agent.id)
  );

  const totalAssigned = agentClients.length;
  const managedCount = agentClients.filter((c) => c.state === 'Resuelto').length;
  const pendingCount = agentClients.filter((c) => c.state === 'Pendiente' || c.state === 'No Contactado').length;
  const completionPercentage = totalAssigned > 0 ? Math.round((managedCount / totalAssigned) * 100) : 0;

  // Apply table filters
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

  // Export helper generating CSV compatible with Microsoft Excel and Google Sheets
  const handleExportCSV = (tipo: 'diario' | 'acuerdos' | 'no_contactados') => {
    setIsExportMenuOpen(false);
    let exportData = filteredClients;
    let filename = `Reporte_${tipo}_${agent.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;

    if (tipo === 'acuerdos') {
      exportData = filteredClients.filter((c) => c.state === 'Resuelto');
    } else if (tipo === 'no_contactados') {
      exportData = filteredClients.filter((c) => c.state === 'No Contactado');
    }

    const headers = [
      'Codigo Cliente',
      'Nombre Cliente',
      'Pais',
      'Dias Mora',
      'Rango Mora',
      'Deuda Total ($)',
      'Ultima Gestion',
      'Tipo Gestion',
      'Estado',
      'Prioridad',
      'Telefono',
      'Celular',
      'Gestor Comercial',
    ];

    const rows = exportData.map((c) => [
      `"${c.code}"`,
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.country}"`,
      c.daysArrears,
      `"${c.moraRange} días"`,
      c.totalDebt,
      `"${c.lastManagementDate || ''}"`,
      `"${c.lastManagementType || ''}"`,
      `"${c.state}"`,
      `"${c.priority}"`,
      `"${c.phone1 || ''}"`,
      `"${c.celular || ''}"`,
      `"${c.salesManager || ''}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      {/* ---------------- SLIDE 3: EL AGENTE: PANEL DE CONTROL DIARIO ---------------- */}
      <section className="glass-panel rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
              Operación del Día · {agent.name} ({agent.country})
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
                  onClick={() => handleExportCSV('diario')}
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
                  onClick={() => handleExportCSV('acuerdos')}
                  className="w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <div>
                    <div className="font-semibold">Acuerdos y Pagos Cerrados</div>
                    <div className="text-[11px] text-slate-400">Clientes con gestión resuelta</div>
                  </div>
                </button>
                <button
                  onClick={() => handleExportCSV('no_contactados')}
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
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
              <h3 className="text-sm font-semibold text-slate-200">Tasa de contacto</h3>
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
                  d="M 40 85 L 120 75 L 200 60 L 280 30 L 360 40 L 360 110 L 40 110 Z"
                  fill="url(#contactGradient)"
                />
                <path
                  d="M 40 85 L 120 75 L 200 60 L 280 30 L 360 40"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                />
                
                {/* Data points */}
                <circle cx="40" cy="85" r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="2" />
                <circle cx="120" cy="75" r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="2" />
                <circle cx="200" cy="60" r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="2" />
                <circle cx="280" cy="30" r="4" fill="#60a5fa" stroke="#0f172a" strokeWidth="2" />
                <circle cx="360" cy="40" r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="2" />
              </svg>
            </div>
            
            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-6">
              <span>Lun (15%)</span>
              <span>Mar (18%)</span>
              <span>Mié (22%)</span>
              <span className="text-blue-400 font-bold">Jue (30%)</span>
              <span>Vie (28%)</span>
            </div>
          </div>

          {/* Chart 2: Tasa de acuerdos (esta semana) */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200">Tasa de acuerdos (esta semana)</h3>
              <span className="text-[11px] font-mono text-amber-400 font-medium">Promedio: 18%</span>
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
                  d="M 40 95 L 120 85 L 200 68 L 280 40 L 360 52 L 360 110 L 40 110 Z"
                  fill="url(#agreeGradient)"
                />
                <path
                  d="M 40 95 L 120 85 L 200 68 L 280 40 L 360 52"
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2.5"
                />
                
                {/* Data points */}
                <circle cx="40" cy="95" r="4" fill="#f59e0b" stroke="#0f172a" strokeWidth="2" />
                <circle cx="120" cy="85" r="4" fill="#f59e0b" stroke="#0f172a" strokeWidth="2" />
                <circle cx="200" cy="68" r="4" fill="#f59e0b" stroke="#0f172a" strokeWidth="2" />
                <circle cx="280" cy="40" r="4" fill="#fbbf24" stroke="#0f172a" strokeWidth="2" />
                <circle cx="360" cy="52" r="4" fill="#f59e0b" stroke="#0f172a" strokeWidth="2" />
              </svg>
            </div>

            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-6">
              <span>Lun (10%)</span>
              <span>Mar (14%)</span>
              <span>Mié (18%)</span>
              <span className="text-amber-400 font-bold">Jue (25%)</span>
              <span>Vie (22%)</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- SLIDE 4: LISTA DE GESTIÓN INTELIGENTE ---------------- */}
      <section className="glass-panel rounded-2xl p-6 sm:p-8">
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Lista de Gestión Inteligente</h2>
            <p className="text-xs text-slate-400 mt-1">
              Clientes asignados en partes iguales para gestión de lunes a viernes (8:00 AM - 6:00 PM).
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <span>Mostrando:</span>
            <span className="text-white font-bold">{filteredClients.length}</span>
            <span>de {agentClients.length} clientes</span>
          </div>
        </div>

        {/* Filter controls row matching Slide 4: Filtrar por Rango de Mora, Estado de Gestión, Prioridad */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
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

        {/* Data Table:
            Cód. Cliente | Nombre del Cliente (SAP) | Días de Mora | Monto | Contacto / Teléfono | Gestor Comercial | Estado | Acción */}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3.5 px-4 font-mono">Cód. Cliente</th>
                <th className="py-3.5 px-4">Nombre del Cliente (SAP)</th>
                <th className="py-3.5 px-4 text-center">Días de Mora</th>
                <th className="py-3.5 px-4 text-right">Monto</th>
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
                      {/* Cód. Cliente (Primera Columna) */}
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
                            {client.scheduledTime && (
                              <span className="ml-2 text-indigo-400 font-semibold">
                                ⏰ {client.scheduledTime}
                              </span>
                            )}
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
                        ${client.totalDebt.toLocaleString('en-US')}
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
    </div>
  );
};
