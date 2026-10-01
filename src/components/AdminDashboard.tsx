import React, { useState } from 'react';
import { Agent, Client, Country, CriticalClient, DynamicField } from '../types';
import {
  Users,
  UserPlus,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Calendar,
  FileSpreadsheet,
  FileText,
  AlertOctagon,
  ArrowUpRight,
  TrendingUp,
  PieChart as PieIcon,
  BarChart3,
  RefreshCw,
  Sparkles,
  Search,
  Eye,
  X,
  Phone,
  Clock,
  ChevronRight,
} from 'lucide-react';

interface AdminDashboardProps {
  currentCountry: Country;
  agents: Agent[];
  clients: Client[];
  dynamicFields: DynamicField[];
  onUpdateDynamicFields: (fields: DynamicField[]) => void;
  onAddAgent: (agent: Omit<Agent, 'id' | 'assignedCount' | 'managedCount' | 'pendingCount' | 'effectivenessRate'>) => void;
  onDistributeCartera: () => void;
  criticalClients: CriticalClient[];
  onEscalateClient: (client: CriticalClient) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentCountry,
  agents,
  clients,
  dynamicFields,
  onUpdateDynamicFields,
  onAddAgent,
  onDistributeCartera,
  criticalClients,
  onEscalateClient,
}) => {
  // Agent inspection modal state
  const [inspectedAgent, setInspectedAgent] = useState<Agent | null>(null);
  const [inspectorSearch, setInspectorSearch] = useState<string>('');

  // Add Agent Modal state (Nombre, País, PBX 4 dígitos, Teléfono celular)
  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentCountry, setNewAgentCountry] = useState<Country>(currentCountry);
  const [newAgentPbx, setNewAgentPbx] = useState('');
  const [newAgentPhone, setNewAgentPhone] = useState('');
  const [addAgentError, setAddAgentError] = useState('');

  // Dynamic builder state
  const [fields, setFields] = useState<DynamicField[]>(dynamicFields);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'dropdown' | 'checkbox' | 'datepicker'>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [distributionSuccessMsg, setDistributionSuccessMsg] = useState(false);

  // Filter agents by current country and role 'agente' (Eduardo is the admin looking at them)
  const countryAgents = agents.filter((a) => a.role === 'agente' && a.country === currentCountry);

  // Real critical clients from SAP with 120+ days
  const realCriticalList = clients
    .filter((c) => c.country === currentCountry && c.daysArrears > 120)
    .slice(0, 6);

  // Add agent handler with validated 4 digits PBX, country, phone, and name
  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    setAddAgentError('');

    const cleanName = newAgentName.trim();
    const cleanPbx = newAgentPbx.trim();
    const cleanPhone = newAgentPhone.trim();

    if (!cleanName) {
      setAddAgentError('Por favor ingresa el nombre del agente.');
      return;
    }

    if (!/^\d{4}$/.test(cleanPbx)) {
      setAddAgentError('La extensión PBX debe tener exactamente 4 números (ej. 1024).');
      return;
    }

    if (!cleanPhone) {
      setAddAgentError('Por favor ingresa el número de teléfono celular.');
      return;
    }

    onAddAgent({
      name: cleanName,
      email: `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@red.com.sv`,
      phone: cleanPhone,
      pbxExtension: cleanPbx,
      country: newAgentCountry,
      role: 'agente',
      status: 'activo',
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanName)}`,
    });

    setNewAgentName('');
    setNewAgentPbx('');
    setNewAgentPhone('');
    setIsAddAgentModalOpen(false);
  };

  // Add custom dynamic field
  const handleAddField = () => {
    if (!newFieldLabel.trim()) return;
    const newField: DynamicField = {
      id: `f-${Date.now()}`,
      name: newFieldLabel.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      label: newFieldLabel,
      type: newFieldType,
      isRequired: newFieldRequired,
      order: fields.length + 1,
      isActive: true,
      options:
        newFieldType === 'dropdown' || newFieldType === 'checkbox'
          ? newFieldOptions
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : undefined,
    };
    const updated = [...fields, newField];
    setFields(updated);
    setNewFieldLabel('');
    setNewFieldOptions('');
    setNewFieldRequired(false);
  };

  // Save fields configuration
  const handleSaveConfiguration = () => {
    onUpdateDynamicFields(fields);
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 3000);
  };

  // Trigger monthly workload distribution
  const handleTriggerDistribution = () => {
    onDistributeCartera();
    setDistributionSuccessMsg(true);
    setTimeout(() => setDistributionSuccessMsg(false), 4000);
  };

  // Export full excel report
  const handleExportFullExcel = () => {
    const headers = [
      'Codigo Cliente',
      'Nombre Cliente',
      'Pais',
      'Dias Mora',
      'Rango Mora',
      'Total Deuda ($)',
      'Estado',
      'Prioridad',
      'Agente Asignado',
      'Horario Programado',
    ];
    const rows = clients.map((c) => {
      const assigned = agents.find((a) => a.id === c.assignedAgentId);
      return [
        `"${c.code}"`,
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.country}"`,
        c.daysArrears,
        `"${c.moraRange}"`,
        c.totalDebt,
        `"${c.state}"`,
        `"${c.priority}"`,
        `"${assigned?.name || 'María Rodríguez'}"`,
        `"${c.scheduledTime || '08:00 AM'}"`,
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reporte_Ejecutivo_Cobranza_${currentCountry}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Print formatted report as PDF
  const handlePrintPDF = () => {
    window.print();
  };

  // Inspector clients for selected agent
  const inspectedAgentClients = inspectedAgent
    ? clients.filter(
        (c) =>
          c.country === inspectedAgent.country &&
          (!c.assignedAgentId || c.assignedAgentId === inspectedAgent.id) &&
          (inspectorSearch === '' ||
            c.name.toLowerCase().includes(inspectorSearch.toLowerCase()) ||
            c.code.toLowerCase().includes(inspectorSearch.toLowerCase()))
      )
    : [];

  return (
    <div className="space-y-8">
      {/* ---------------- SLIDE 7: EL ADMINISTRADOR: VISIBILIDAD Y CONTROL ---------------- */}
      <section className="glass-panel rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
              Panel Administrativo y Supervisión · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              El Administrador: Visibilidad y Control
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTriggerDistribution}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 transition-all cursor-pointer"
              title="Divide la cartera en partes iguales para la gestión de cobranza"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Repartir Cartera del Mes</span>
            </button>
          </div>
        </div>

        {distributionSuccessMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-950/70 border border-emerald-500 text-emerald-300 text-xs flex items-center justify-between shadow-lg shadow-emerald-900/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>
                <strong>¡Distribución completada!</strong> La cartera real de {currentCountry} fue distribuida equitativamente entre los agentes para la gestión de cobranza.
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* ========================================================================= */}
          {/* LEFT: GESTIÓN DE EQUIPO (Haz clic en un agente para ver su gestión) */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  Equipo de Cobro ({currentCountry})
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Haz clic encima del agente para supervisar su cartera y gestión
                </p>
              </div>

              <button
                onClick={() => setIsAddAgentModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-blue-400" />
                <span>Añadir Agente</span>
              </button>
            </div>

            <div className="space-y-3">
              {countryAgents.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                  No hay agentes activos en {currentCountry}. Haz clic en "+ Añadir Agente" para agregar uno.
                </div>
              ) : (
                countryAgents.map((ag) => {
                  const assignedCount = clients.filter(
                    (c) => c.country === ag.country && (!c.assignedAgentId || c.assignedAgentId === ag.id)
                  ).length;
                  const managedCount = clients.filter(
                    (c) =>
                      c.country === ag.country &&
                      (!c.assignedAgentId || c.assignedAgentId === ag.id) &&
                      c.state === 'Resuelto'
                  ).length;

                  return (
                    <div
                      key={ag.id}
                      onClick={() => setInspectedAgent(ag)}
                      className="p-4 rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-blue-500/60 flex items-center justify-between gap-4 transition-all cursor-pointer group shadow-sm"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="relative">
                          <img
                            src={ag.avatarUrl}
                            alt={ag.name}
                            className="w-12 h-12 rounded-full object-cover border-2 border-slate-700 group-hover:border-blue-400 transition-colors"
                          />
                          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-slate-900" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-100 flex items-center gap-2 group-hover:text-blue-300 transition-colors">
                            <span>{ag.name}</span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/50">
                              {ag.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1 font-mono font-medium text-blue-400 bg-blue-950/40 px-1.5 py-0.2 rounded border border-blue-800/40">
                              <Phone className="w-3 h-3 text-blue-400" />
                              PBX: {ag.pbxExtension || '1021'}
                            </span>
                            <span className="font-mono text-slate-300">
                              {ag.phone}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                            <span>Asignados: <strong className="text-slate-200">{assignedCount}</strong></span>
                            <span>·</span>
                            <span>Resueltos: <strong className="text-emerald-400">{managedCount}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-sm font-mono font-bold text-emerald-400 tabular-nums">
                            {ag.effectivenessRate}%
                          </div>
                          <div className="text-[11px] text-blue-400 font-medium flex items-center gap-1 justify-end group-hover:translate-x-0.5 transition-transform">
                            <span>Ver gestión</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* RIGHT: CONSTRUCTOR DINÁMICO */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Constructor Dinámico de Bitácora
              </h3>
              <span className="text-xs text-slate-400">Campos en formulario de cobro</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
              {/* Existing active fields list */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {fields.map((f, i) => (
                  <div
                    key={f.id}
                    className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-slate-500 w-4">
                        {i + 1}
                      </span>
                      <span className="font-semibold text-slate-200">{f.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/40">
                        {f.type}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`text-[10px] font-semibold ${
                          f.isRequired ? 'text-amber-400' : 'text-slate-500'
                        }`}
                      >
                        {f.isRequired ? 'Obligatorio' : 'Opcional'}
                      </span>
                      <button
                        onClick={() => setFields(fields.filter((item) => item.id !== f.id))}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                        title="Eliminar campo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new field row */}
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="text-xs font-semibold text-slate-300">Añadir Nuevo Campo a la Bitácora:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Etiqueta del campo (ej: Canal Preferido)"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    className="px-3 py-2 text-xs rounded-xl glass-input font-medium"
                  />
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as any)}
                    className="px-3 py-2 text-xs rounded-xl glass-input font-medium"
                  >
                    <option value="text" className="bg-slate-900">Texto</option>
                    <option value="dropdown" className="bg-slate-900">Dropdown</option>
                    <option value="checkbox" className="bg-slate-900">Checkbox</option>
                    <option value="datepicker" className="bg-slate-900">Datepicker</option>
                  </select>
                </div>

                {(newFieldType === 'dropdown' || newFieldType === 'checkbox') && (
                  <input
                    type="text"
                    placeholder="Opciones separadas por coma (ej: WhatsApp, Correo, Llamada Directa)"
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                  />
                )}

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newFieldRequired}
                      onChange={(e) => setNewFieldRequired(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Campo Obligatorio</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleAddField}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
                  >
                    + Agregar Campo
                  </button>
                </div>
              </div>

              {/* Botón Guardar Configuración */}
              <div className="pt-2">
                <button
                  onClick={handleSaveConfiguration}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>Guardar Configuración</span>
                </button>
                {saveSuccessMsg && (
                  <div className="mt-2 text-center text-xs text-emerald-400 font-semibold">
                    ✓ Configuración guardada. Los agentes ya ven estos campos en su formulario de cobro.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- SLIDE 8: INTELIGENCIA DE NEGOCIO ---------------- */}
      <section className="glass-panel rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
              Analítica Gerencial y Cartera Real SAP
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Inteligencia de Negocio</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportFullExcel}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Excel</span>
            </button>
            <button
              onClick={handlePrintPDF}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
            >
              <FileText className="w-4 h-4 text-red-400" />
              <span>PDF</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Recuperación vs. Inversión
              </h3>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-blue-400">
                  <span className="w-2.5 h-2.5 rounded bg-blue-500" />
                  Recuperación
                </span>
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="w-2.5 h-2.5 rounded bg-slate-600" />
                  Inversión
                </span>
              </div>
            </div>

            <div className="h-48 flex items-end justify-between gap-4 pt-4 px-4 pb-2 border-b border-slate-800 font-mono text-xs">
              <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-36">
                  <div style={{ height: '35%' }} className="w-1/2 bg-blue-500 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-white">$1.2K</div>
                  <div style={{ height: '30%' }} className="w-1/2 bg-slate-600 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-slate-200">$1.0K</div>
                </div>
                <span className="text-slate-400 text-xs">Q1</span>
              </div>

              <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-36">
                  <div style={{ height: '55%' }} className="w-1/2 bg-blue-500 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-white">$1.7K</div>
                  <div style={{ height: '65%' }} className="w-1/2 bg-slate-600 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-slate-200">$2.0K</div>
                </div>
                <span className="text-slate-400 text-xs">Q2</span>
              </div>

              <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-36">
                  <div style={{ height: '90%' }} className="w-1/2 bg-blue-500 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-white">$3.8K</div>
                  <div style={{ height: '80%' }} className="w-1/2 bg-slate-600 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-slate-200">$3.3K</div>
                </div>
                <span className="text-slate-400 text-xs">Q3</span>
              </div>

              <div className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-36">
                  <div style={{ height: '80%' }} className="w-1/2 bg-blue-500 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-white">$3.2K</div>
                  <div style={{ height: '95%' }} className="w-1/2 bg-slate-600 rounded-t flex items-start justify-center pt-1 text-[10px] font-bold text-slate-200">$3.9K</div>
                </div>
                <span className="text-slate-400 text-xs">Q4</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-4">
              Distribución de Cartera por Rango de Mora (SAP)
            </h3>

            <div className="flex flex-col sm:flex-row items-center justify-around gap-6">
              <div className="relative w-36 h-36">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray="35 65" strokeDashoffset="0" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#f97316" strokeWidth="4" strokeDasharray="20 80" strokeDashoffset="-35" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#eab308" strokeWidth="4" strokeDasharray="15 85" strokeDashoffset="-55" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#ea580c" strokeWidth="4" strokeDasharray="10 90" strokeDashoffset="-70" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#ef4444" strokeWidth="4" strokeDasharray="20 80" strokeDashoffset="-80" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xs font-mono font-bold text-white">{clients.length}</span>
                  <span className="text-[10px] text-slate-400">Clientes SAP</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs font-medium">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-slate-300">0-30 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {clients.filter((c) => c.country === currentCountry && c.moraRange === '0-30').length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-400" />
                  <span className="text-slate-300">31-60 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {clients.filter((c) => c.country === currentCountry && c.moraRange === '31-60').length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <span className="text-slate-300">61-90 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {clients.filter((c) => c.country === currentCountry && c.moraRange === '61-90').length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-600" />
                  <span className="text-slate-300">91-120 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {clients.filter((c) => c.country === currentCountry && c.moraRange === '91-120').length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="text-slate-300">120+ días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {clients.filter((c) => c.country === currentCountry && c.moraRange === '120+').length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-12 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Tasa de Efectividad Operativa
                </h3>
                <div className="mt-3 text-4xl font-extrabold tracking-tight text-white tabular-nums">92.5%</div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-1">
                {['Diario', 'Semanal', 'Mensual'].map((period, index) => (
                  <button
                    key={period}
                    className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                      index === 2
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>

              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 justify-end">
                  <TrendingUp className="w-3.5 h-3.5" />
                  +4.2% vs. período anterior
                </span>
                <span className="mt-1 text-[11px] text-slate-400">Meta: 85%</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Actual</div>
                <div className="mt-2 text-2xl font-extrabold text-white tabular-nums">92.5%</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Meta</div>
                <div className="mt-2 text-2xl font-extrabold text-blue-300 tabular-nums">85%</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Variación</div>
                <div className="mt-2 text-2xl font-extrabold text-emerald-400 tabular-nums">+4.2%</div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 text-xs font-semibold text-slate-300">Tendencia</div>
              <div className="h-28 w-full">
                <svg className="w-full h-full" viewBox="0 0 350 100" preserveAspectRatio="none">
                  <path d="M 20 80 Q 75 50, 130 70 T 240 40 T 330 20" fill="none" stroke="#3b82f6" strokeWidth="3" />
                  <circle cx="20" cy="80" r="4" fill="#3b82f6" />
                  <circle cx="80" cy="55" r="4" fill="#3b82f6" />
                  <circle cx="140" cy="65" r="4" fill="#3b82f6" />
                  <circle cx="200" cy="45" r="4" fill="#3b82f6" />
                  <circle cx="260" cy="40" r="4" fill="#3b82f6" />
                  <circle cx="330" cy="20" r="6" fill="#60a5fa" stroke="#0f172a" strokeWidth="2" />
                </svg>
              </div>
              <div className="flex justify-between text-[11px] font-mono text-slate-400 px-3">
                <span>Ene</span>
                <span>Feb</span>
                <span>Mar</span>
                <span>Abr</span>
                <span>May</span>
                <span className="text-blue-400 font-bold">Jun</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Recuperación Mensual de Cartera
                </h3>
                <div className="mt-2 text-[11px] text-slate-400">Monto recuperado de cuentas por cobrar durante el período</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-semibold text-slate-200">Excel</button>
                <button className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-semibold text-slate-200">PDF</button>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-3 text-center text-[10px] text-slate-400 font-mono">
              <div><div className="text-[10px]">Ene</div><div className="mt-1 text-white font-bold">$3,200</div></div>
              <div><div className="text-[10px]">Feb</div><div className="mt-1 text-white font-bold">$4,100</div></div>
              <div><div className="text-[10px]">Mar</div><div className="mt-1 text-white font-bold">$5,600</div></div>
              <div><div className="text-[10px]">Abr</div><div className="mt-1 text-white font-bold">$4,950</div></div>
              <div><div className="text-[10px]">May</div><div className="mt-1 text-white font-bold">$6,200</div></div>
              <div><div className="text-[10px] text-blue-400">Jun</div><div className="mt-1 text-blue-300 font-bold">$6,850</div></div>
            </div>
          </div>

          <div className="lg:col-span-6 p-4 rounded-xl bg-red-950/30 border border-red-800/60 shadow-lg shadow-red-950/40 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-red-200">
                  Clientes Críticos 120+ días
                </h3>
              </div>
              <span className="text-[11px] font-mono text-red-300">
                {realCriticalList.length} detectados
              </span>
            </div>

            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {realCriticalList.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  No hay clientes con mora crítica superior a 120 días en este momento.
                </div>
              ) : (
                realCriticalList.map((client) => (
                  <div
                    key={client.code}
                    className="p-3 rounded-xl bg-slate-900/90 border border-red-900/40 flex items-center justify-between gap-3"
                  >
                    <div className="max-w-[65%]">
                      <div className="text-xs font-bold text-white truncate">
                        {client.name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        <span className="text-blue-400 font-bold">{client.code}</span> · {client.daysArrears} días de mora
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold font-mono text-red-400 tabular-nums">
                        ${client.totalDebt.toLocaleString('en-US')}
                      </span>
                      <button
                        onClick={() =>
                          onEscalateClient({
                            id: `crit-${client.code}`,
                            clientCode: client.code,
                            name: client.name,
                            country: client.country,
                            totalDebt: client.totalDebt,
                            daysArrears: client.daysArrears,
                            escalationStatus: 'Escalado',
                          })
                        }
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-700 hover:bg-red-600 shadow-md shadow-red-700/30 transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                      >
                        <span>↑</span>
                        <span>Escalar</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* MODAL DE SUPERVISIÓN DETALLADA DE AGENTE */}
      {inspectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-5xl rounded-2xl glass-panel border border-slate-700 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header Inspector */}
            <div className="p-6 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <img
                  src={inspectedAgent.avatarUrl}
                  alt={inspectedAgent.name}
                  className="w-14 h-14 rounded-full border-2 border-blue-500 object-cover shadow-lg"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{inspectedAgent.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/60">
                      {inspectedAgent.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    {inspectedAgent.email} · {inspectedAgent.phone}
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setInspectedAgent(null);
                  setInspectorSearch('');
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metrics cards of this agent */}
            <div className="p-6 bg-slate-950/40 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">Total Asignados</div>
                <div className="text-xl font-bold font-mono text-white mt-0.5">
                  {inspectedAgentClients.length}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">Gestionados (Resueltos)</div>
                <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                  {inspectedAgentClients.filter((c) => c.state === 'Resuelto').length}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">Pendientes por Llamar</div>
                <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
                  {inspectedAgentClients.filter((c) => c.state !== 'Resuelto').length}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-[11px] text-slate-400">Tasa de Efectividad</div>
                <div className="text-xl font-bold font-mono text-blue-400 mt-0.5">
                  {inspectedAgent.effectivenessRate}%
                </div>
              </div>
            </div>

            {/* Table of clients assigned to this agent */}
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Cartera Asignada al Agente
                </h4>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Buscar en cartera..."
                    value={inspectorSearch}
                    onChange={(e) => setInspectorSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl glass-input"
                  />
                </div>
              </div>

              <div className="overflow-x-auto overflow-y-auto max-h-[520px] rounded-xl border border-slate-800 shadow-inner">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-800 shadow-sm">
                    <tr>
                      <th className="py-3 px-3 font-mono">Cód. Cliente</th>
                      <th className="py-3 px-3">Cliente Real (SAP)</th>
                      <th className="py-3 px-3 text-center">Días Mora</th>
                      <th className="py-3 px-3 text-right">Monto</th>
                      <th className="py-3 px-3">Contacto</th>
                      <th className="py-3 px-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {inspectedAgentClients.slice(0, 50).map((c) => (
                      <tr key={c.code} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-400">
                          {c.code}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200 font-semibold truncate max-w-xs">
                          {c.name}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border ${
                              c.daysArrears > 120
                                ? 'bg-red-950 text-red-300 border-red-800'
                                : c.daysArrears > 60
                                ? 'bg-amber-950 text-amber-300 border-amber-800'
                                : 'bg-blue-950 text-blue-300 border-blue-800'
                            }`}
                          >
                            {c.daysArrears} días
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-100 tabular-nums">
                          ${c.totalDebt.toLocaleString('en-US')}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                          {c.phone1 || c.celular || 'Sin teléfono'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              c.state === 'Resuelto'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-blue-950 text-blue-300 border border-blue-800'
                            }`}
                          >
                            {c.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Añadir Agente */}
      {isAddAgentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl glass-panel border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-400" />
                Añadir Nuevo Agente de Cobro
              </h3>
              <button
                onClick={() => setIsAddAgentModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAgent} className="space-y-3.5">
              {addAgentError && (
                <div className="p-2.5 text-xs rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
                  {addAgentError}
                </div>
              )}

              {/* 1. Nombre Completo */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Claudia Morales"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
                />
              </div>

              {/* 2. País Asignado */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  País Asignado *
                </label>
                <select
                  value={newAgentCountry}
                  onChange={(e) => setNewAgentCountry(e.target.value as Country)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium text-white cursor-pointer"
                >
                  <option value="SV" className="bg-slate-900">🇸🇻 El Salvador</option>
                  <option value="GT" className="bg-slate-900">🇬🇹 Guatemala</option>
                </select>
              </div>

              {/* 3. Extensión PBX (4 números) */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Extensión PBX (4 Números) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={4}
                  placeholder="Ej: 1024"
                  value={newAgentPbx}
                  onChange={(e) => setNewAgentPbx(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white placeholder:text-slate-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Exactamente 4 dígitos para discado en central telefónica.
                </span>
              </div>

              {/* 4. Teléfono Celular */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Teléfono Celular *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 7890-1234"
                  value={newAgentPhone}
                  onChange={(e) => setNewAgentPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
                />
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddAgentModalOpen(false)}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30 cursor-pointer"
                >
                  Guardar Agente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
