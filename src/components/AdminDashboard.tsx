import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
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
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [draftFieldId, setDraftFieldId] = useState<string | null>(null);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<DynamicField['type']>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [optionDraft, setOptionDraft] = useState('');
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [distributionSuccessMsg, setDistributionSuccessMsg] = useState(false);
  const [selectedTrendPeriod, setSelectedTrendPeriod] = useState<'Diario' | 'Semanal' | 'Mensual'>('Mensual');

  const fieldUiMeta: Record<DynamicField['type'], { accent: string; badge: string }> = {
    text: { accent: 'text-blue-300', badge: 'bg-blue-950/70 border-blue-700/60 text-blue-200' },
    textarea: { accent: 'text-violet-300', badge: 'bg-violet-950/70 border-violet-700/60 text-violet-200' },
    number: { accent: 'text-cyan-300', badge: 'bg-cyan-950/70 border-cyan-700/60 text-cyan-200' },
    money: { accent: 'text-emerald-300', badge: 'bg-emerald-950/70 border-emerald-700/60 text-emerald-200' },
    date: { accent: 'text-sky-300', badge: 'bg-sky-950/70 border-sky-700/60 text-sky-200' },
    dropdown: { accent: 'text-violet-300', badge: 'bg-violet-950/70 border-violet-700/60 text-violet-200' },
    checkbox: { accent: 'text-amber-300', badge: 'bg-amber-950/70 border-amber-700/60 text-amber-200' },
    radio: { accent: 'text-pink-300', badge: 'bg-pink-950/70 border-pink-700/60 text-pink-200' },
    yesno: { accent: 'text-teal-300', badge: 'bg-teal-950/70 border-teal-700/60 text-teal-200' },
    phone: { accent: 'text-indigo-300', badge: 'bg-indigo-950/70 border-indigo-700/60 text-indigo-200' },
    email: { accent: 'text-fuchsia-300', badge: 'bg-fuchsia-950/70 border-fuchsia-700/60 text-fuchsia-200' },
    datepicker: { accent: 'text-sky-300', badge: 'bg-sky-950/70 border-sky-700/60 text-sky-200' },
  };

  const fieldTypeLabel: Record<DynamicField['type'], string> = {
    text: 'Texto corto',
    textarea: 'Texto largo',
    number: 'Número',
    money: 'Dinero',
    date: 'Fecha',
    dropdown: 'Lista desplegable',
    checkbox: 'Casilla de verificación',
    radio: 'Selección única',
    yesno: 'Sí / No',
    phone: 'Teléfono',
    email: 'Correo electrónico',
    datepicker: 'Fecha',
  };

  const fieldPlaceholder: Record<DynamicField['type'], string> = {
    text: 'Escriba aquí',
    textarea: 'Escriba aquí',
    number: 'Ingrese un número',
    money: 'Ingrese monto',
    date: 'Seleccione una fecha',
    dropdown: 'Seleccionar opción',
    checkbox: 'Seleccionar opciones',
    radio: 'Seleccionar opción',
    yesno: 'Seleccionar opción',
    phone: 'Ingrese teléfono',
    email: 'Ingrese correo electrónico',
    datepicker: 'dd/mm/aaaa',
  };

  useEffect(() => {
    setFields([...dynamicFields].sort((a, b) => (a.order || 0) - (b.order || 0)));
  }, [dynamicFields]);

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

  const getFieldSlug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `campo_${Date.now()}`;

  const resetDraft = () => {
    setDraftFieldId(null);
    setNewFieldLabel('');
    setNewFieldType('text');
    setNewFieldRequired(false);
    setNewFieldOptions([]);
    setOptionDraft('');
    setIsComposerOpen(false);
  };

  const handleAddOption = () => {
    const value = optionDraft.trim();
    if (!value) return;
    setNewFieldOptions((prev) => [...prev, value]);
    setOptionDraft('');
  };

  const handleSaveDraftField = () => {
    if (!newFieldLabel.trim()) return;
    const sanitizedOptions = ['dropdown', 'checkbox', 'radio'].includes(newFieldType)
      ? newFieldOptions.filter(Boolean)
      : [];

    const nextField: DynamicField = {
      id: draftFieldId || `f-${Date.now()}`,
      name: getFieldSlug(newFieldLabel),
      label: newFieldLabel.trim(),
      type: newFieldType,
      isRequired: newFieldRequired,
      order: draftFieldId ? fields.find((f) => f.id === draftFieldId)?.order || fields.length + 1 : fields.length + 1,
      isActive: true,
      options: sanitizedOptions.length ? sanitizedOptions : undefined,
    };

    setFields((prev) => {
      if (draftFieldId) {
        const updated = prev.map((field) => (field.id === draftFieldId ? { ...field, ...nextField } : field));
        return [...updated].sort((a, b) => (a.order || 0) - (b.order || 0));
      }
      return [...prev, { ...nextField, order: prev.length + 1 }];
    });

    resetDraft();
  };

  const handleEditField = (field: DynamicField) => {
    setDraftFieldId(field.id);
    setNewFieldLabel(field.label);
    setNewFieldType(field.type);
    setNewFieldRequired(Boolean(field.isRequired));
    setNewFieldOptions(field.options || []);
    setIsComposerOpen(true);
  };

  const handleDuplicateField = (field: DynamicField) => {
    const duplicate: DynamicField = {
      ...field,
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${field.name}_${Date.now()}`,
      label: `${field.label} (Copia)`,
      order: fields.length + 1,
    };
    setFields((prev) => [...prev, duplicate]);
  };

  const handleDeleteField = (fieldId: string) => {
    setFields((prev) => {
      const next = prev.filter((field) => field.id !== fieldId);
      return next.map((field, idx) => ({ ...field, order: idx + 1 }));
    });
  };

  const reorderFields = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setFields((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((field) => field.id === sourceId);
      const targetIndex = next.findIndex((field) => field.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1) return prev;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next.map((field, index) => ({ ...field, order: index + 1 }));
    });
  };

  // Save fields configuration
  const handleSaveConfiguration = () => {
    const ordered = [...fields].sort((a, b) => (a.order || 0) - (b.order || 0)).map((field, index) => ({ ...field, order: index + 1 }));
    setFields(ordered);
    onUpdateDynamicFields(ordered);
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 3000);
  };

  // Trigger monthly workload distribution
  const handleTriggerDistribution = () => {
    onDistributeCartera();
    setDistributionSuccessMsg(true);
    setTimeout(() => setDistributionSuccessMsg(false), 4000);
  };

  const activeAgentIds = countryAgents.map((agent) => agent.id);
  const currentCountryClients = clients.filter((client) => client.country === currentCountry);
  const managedCountryClients = currentCountryClients.filter((client) => {
    if (client.state !== 'Resuelto') return false;
    if (activeAgentIds.length === 0) return true;
    return !client.assignedAgentId || activeAgentIds.includes(client.assignedAgentId);
  });
  const pendingCountryClients = currentCountryClients.filter(
    (client) => client.state === 'Pendiente' || client.state === 'No Contactado'
  );
  const evaluationBase = currentCountryClients.filter((client) => {
    if (activeAgentIds.length === 0) return true;
    return !client.assignedAgentId || activeAgentIds.includes(client.assignedAgentId);
  });
  const operationalRate = evaluationBase.length > 0
    ? (managedCountryClients.length / evaluationBase.length) * 100
    : 0;
  const operationalTarget = 85;
  const operationalDelta = operationalRate - operationalTarget;

  const chartMonthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'];
  const chartMonthRecovery = chartMonthLabels.map((label, index) => {
    const monthDate = new Date();
    monthDate.setDate(1);
    monthDate.setMonth(monthDate.getMonth() - (chartMonthLabels.length - 1 - index));

    const monthlyClients = currentCountryClients.filter((client) => {
      const managementDate = client.lastManagementDate || client.invoiceDate || client.dueDate;
      if (!managementDate) return false;
      const parsedDate = new Date(managementDate);
      if (Number.isNaN(parsedDate.getTime())) return false;
      return parsedDate.getFullYear() === monthDate.getFullYear() && parsedDate.getMonth() === monthDate.getMonth() && client.state === 'Resuelto';
    });

    return {
      label,
      amount: monthlyClients.reduce((sum, client) => sum + (client.totalDebt || 0), 0),
      rate: monthlyClients.length > 0 ? (monthlyClients.length / Math.max(currentCountryClients.length, 1)) * 100 : 0,
    };
  });

  const trendSeries = {
    Diario: chartMonthRecovery.map((item, idx) =>
      idx === chartMonthRecovery.length - 1
        ? Math.max(0, Math.min(100, operationalRate))
        : Math.max(0, Math.min(100, item.rate * 1.2))
    ),
    Semanal: chartMonthRecovery.map((item, idx) =>
      idx === chartMonthRecovery.length - 1
        ? Math.max(0, Math.min(100, operationalRate))
        : Math.max(0, Math.min(100, item.rate * 1.1 + idx * 2.1))
    ),
    Mensual: chartMonthRecovery.map((item) => Math.max(0, Math.min(100, item.rate * 1.5))),
  } as const;

  const trendValues = trendSeries[selectedTrendPeriod];
  const trendPath = trendValues
    .map((value, index) => {
      const x = 18 + index * 62;
      const y = 88 - (value / 100) * 65;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const exportWorkbook = (title: string, rows: Array<Array<string | number>>, headers: string[]) => {
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, title);
    XLSX.writeFile(workbook, `${title}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportTrendExcel = () => {
    exportWorkbook(
      `Tendencia_Efectividad_${currentCountry}`,
      trendSeries[selectedTrendPeriod].map((value, index) => [chartMonthLabels[index], `${value.toFixed(1)}%`]),
      ['Mes', 'Efectividad %']
    );
  };

  const handleExportRecoveryExcel = () => {
    exportWorkbook(
      `Recuperacion_Mensual_${currentCountry}`,
      chartMonthRecovery.map((item) => [item.label, item.amount]),
      ['Mes', 'Monto Recuperado']
    );
  };

  const handlePrintPdfExport = () => {
    window.print();
  };

  // Export full executive excel report as a real XLSX workbook
  const handleExportFullExcel = () => {
    const headers = [
      'Código Cliente',
      'Nombre Cliente',
      'País',
      'Días Mora',
      'Rango Mora',
      'Deuda Total',
      'Estado',
      'Prioridad',
      'Agente Asignado',
      'Horario Programado',
    ];

    const countryLabel = currentCountry === 'SV' ? 'El Salvador' : 'Guatemala';
    const currencyFormat = currentCountry === 'SV' ? '$ #,##0.00' : 'Q #,##0.00';
    const rows = clients
      .filter((c) => c.country === currentCountry)
      .map((c) => {
        const assigned = agents.find((a) => a.id === c.assignedAgentId);
        return [
          c.code,
          c.name,
          countryLabel,
          Number(c.daysArrears || 0),
          c.moraRange || '0-30',
          Number(c.totalDebt || 0),
          c.state || 'Pendiente',
          c.priority || 'Normal',
          assigned?.name || 'María Rodríguez',
          c.scheduledTime || '08:00 AM',
        ];
      });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!freeze'] = { ySplit: 1 };
    ws['!autofilter'] = { ref: 'A1:J1' };
    ws['!cols'] = [
      { wch: 15 },
      { wch: 40 },
      { wch: 15 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 15 },
      { wch: 22 },
      { wch: 18 },
    ];

    headers.forEach((_, index) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: index });
      const cell = ws[cellRef];
      if (cell) {
        cell.s = {
          fill: { fgColor: { rgb: '1F2937' } },
          font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: 'D1D5DB' } },
            bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
            left: { style: 'thin', color: { rgb: 'D1D5DB' } },
            right: { style: 'thin', color: { rgb: 'D1D5DB' } },
          },
        };
      }
    });

    for (let r = 1; r <= rows.length; r += 1) {
      for (let c = 0; c < 10; c += 1) {
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
        if (c === 1 || c === 2 || c === 9) {
          cell.s = { ...(cell.s || {}), alignment: { wrapText: true, vertical: 'center' } };
        }
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, 'Reporte Ejecutivo');
    XLSX.writeFile(workbook, `Reporte_Ejecutivo_Cobranza_${currentCountry}_${new Date().toISOString().split('T')[0]}.xlsx`);
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
    <div id="inicio" className="space-y-8">
      {/* ---------------- SLIDE 7: EL ADMINISTRADOR: VISIBILIDAD Y CONTROL ---------------- */}
      <section id="equipo-cobro" className="glass-panel rounded-2xl p-6 sm:p-8">
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

        <div className="grid grid-cols-1 gap-8">
          {/* ========================================================================= */}
          {/* LEFT: GESTIÓN DE EQUIPO (Haz clic en un agente para ver su gestión) */}
          {/* ========================================================================= */}
          <div className="space-y-4">
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
          <div id="constructor-bitacora" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Constructor Dinámico de Bitácora
              </h3>
              <button
                type="button"
                onClick={() => { setIsComposerOpen(true); setDraftFieldId(null); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/60 bg-blue-950/50 px-3 py-1.5 text-[11px] font-semibold text-blue-200 transition hover:bg-blue-900/70"
              >
                <span>+</span>
                <span>Añadir Campo</span>
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5 xl:gap-6 xl:items-stretch">
              <div className="min-h-[540px] p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-slate-100 leading-snug">Campos activos</div>
                    <div className="mt-1 text-[11px] text-slate-400">Configura el orden y propiedades de la bitácora.</div>
                  </div>
                  <span className="flex-shrink-0 rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200">{fields.length} campos</span>
                </div>

                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                  {[...fields].sort((a, b) => (a.order || 0) - (b.order || 0)).map((field, index) => {
                    const meta = fieldUiMeta[field.type] || fieldUiMeta.text;
                    return (
                      <div
                        key={field.id}
                        draggable
                        onDragStart={() => setDraggedFieldId(field.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { if (draggedFieldId) reorderFields(draggedFieldId, field.id); setDraggedFieldId(null); }}
                        className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-sm transition hover:border-blue-500/60 hover:bg-slate-950"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5">
                            <span className="mt-0.5 cursor-grab text-slate-500" title="Mover campo">
                              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M6 4h2v2H6zm6 0h2v2h-2zm-6 6h2v2H6zm6 0h2v2h-2zM6 16h2v2H6zm6 0h2v2h-2z" /></svg>
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-[10px] font-bold text-slate-300">{index + 1}</span>
                                <span className="break-words text-sm font-semibold leading-snug text-white">{field.label}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badge}`}>{fieldTypeLabel[field.type] || field.type}</span>
                                <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${field.isRequired ? 'text-amber-300' : 'text-slate-400'}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${field.isRequired ? 'bg-amber-400' : 'bg-slate-500'}`} />
                                  {field.isRequired ? 'Obligatorio' : 'Opcional'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2 text-slate-400">
                            <button type="button" onClick={() => handleEditField(field)} className="rounded-md p-1 hover:text-blue-300 hover:bg-slate-800/80 transition-colors" title="Editar"><svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current stroke-2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg></button>
                            <button type="button" onClick={() => handleDuplicateField(field)} className="rounded-md p-1 hover:text-violet-300 hover:bg-slate-800/80 transition-colors" title="Duplicar"><svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current stroke-2"><path d="M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4"/><path d="M5 15V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/></svg></button>
                            <button type="button" onClick={() => handleDeleteField(field.id)} className="rounded-md p-1 hover:text-red-300 hover:bg-slate-800/80 transition-colors" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {isComposerOpen && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{draftFieldId ? 'Editar campo' : 'Nuevo campo'}</div>
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={newFieldLabel}
                        onChange={(e) => setNewFieldLabel(e.target.value)}
                        placeholder="Nombre del campo"
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder:text-slate-500"
                      />

                      <select
                        value={newFieldType}
                        onChange={(e) => setNewFieldType(e.target.value as DynamicField['type'])}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                      >
                        <option value="text">Texto corto</option>
                        <option value="textarea">Texto largo</option>
                        <option value="number">Número</option>
                        <option value="money">Dinero</option>
                        <option value="date">Fecha</option>
                        <option value="dropdown">Lista desplegable</option>
                        <option value="checkbox">Casilla de verificación</option>
                        <option value="radio">Selección única</option>
                        <option value="yesno">Sí / No</option>
                        <option value="phone">Teléfono</option>
                        <option value="email">Correo electrónico</option>
                      </select>

                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={newFieldRequired} onChange={(e) => setNewFieldRequired(e.target.checked)} className="rounded border-slate-700 bg-slate-900 text-blue-600" />
                        Campo obligatorio
                      </label>

                      {['dropdown', 'checkbox', 'radio'].includes(newFieldType) && (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={optionDraft}
                              onChange={(e) => setOptionDraft(e.target.value)}
                              placeholder="Añadir opción"
                              className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder:text-slate-500"
                            />
                            <button type="button" onClick={handleAddOption} className="rounded-xl bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-200">+ Añadir</button>
                          </div>

                          <div className="space-y-1">
                            {newFieldOptions.map((option, idx) => (
                              <div key={`${option}-${idx}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5 text-[11px] text-slate-200">
                                <span>{option}</span>
                                <button type="button" onClick={() => setNewFieldOptions((prev) => prev.filter((_, i) => i !== idx))} className="text-red-300">✕</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={resetDraft} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-200">Cancelar</button>
                        <button type="button" onClick={handleSaveDraftField} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white">{draftFieldId ? 'Actualizar' : 'Crear Campo'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="min-h-[540px] p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-100">Vista previa</div>
                    <div className="mt-1 text-[11px] text-slate-400">Así verá el formulario el agente de cobros.</div>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400">Vista del agente</span>
                </div>

                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                  {[...fields].sort((a, b) => (a.order || 0) - (b.order || 0)).map((field) => {
                    const type = field.type;
                    const label = field.isRequired ? `${field.label} *` : field.label;
                    const placeholder = fieldPlaceholder[type] || 'Escriba aquí';
                    return (
                      <div key={field.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                        <div className="mb-2 text-xs font-semibold text-slate-200 leading-relaxed">{label}</div>
                        {type === 'textarea' && <textarea rows={3} placeholder={placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200 placeholder:text-slate-500" />}
                        {type === 'dropdown' && (
                          <select className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200">
                            <option value="">Seleccionar opción</option>
                            {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        )}
                        {type === 'checkbox' && (
                          <div className="space-y-2 text-[11px] text-slate-200">
                            {(field.options || []).map((option) => (
                              <label key={option} className="flex items-center gap-2"><input type="checkbox" className="rounded border-slate-700 bg-slate-900" />{option}</label>
                            ))}
                          </div>
                        )}
                        {type === 'radio' && (
                          <div className="space-y-2 text-[11px] text-slate-200">
                            {(field.options || []).map((option) => (
                              <label key={option} className="flex items-center gap-2"><input type="radio" name={field.name} className="border-slate-700 bg-slate-900" />{option}</label>
                            ))}
                          </div>
                        )}
                        {type === 'yesno' && (
                          <select className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200">
                            <option value="">Seleccionar opción</option>
                            <option value="Sí">Sí</option>
                            <option value="No">No</option>
                          </select>
                        )}
                        {type === 'money' && (
                          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-300">
                            <span className="font-semibold text-slate-200">{currentCountry === 'SV' ? '$' : 'Q'}</span>
                            <input type="text" placeholder="0.00" className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 outline-none" />
                          </div>
                        )}
                        {type === 'date' && <input type="date" placeholder="dd/mm/aaaa" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200" />}
                        {type === 'number' && <input type="number" placeholder={placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200 placeholder:text-slate-500" />}
                        {type === 'phone' && <input type="tel" placeholder={placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200 placeholder:text-slate-500" />}
                        {type === 'email' && <input type="email" placeholder={placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200 placeholder:text-slate-500" />}
                        {['text', 'datepicker'].includes(type) && <input type={type === 'datepicker' ? 'date' : 'text'} placeholder={type === 'datepicker' ? 'dd/mm/aaaa' : placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-200 placeholder:text-slate-500" />}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-3">
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
        </div>
      </section>

      {/* ---------------- SLIDE 8: INTELIGENCIA DE NEGOCIO ---------------- */}
      <section id="inteligencia-negocio" className="glass-panel rounded-2xl p-6 sm:p-8">
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
                <div className="mt-3 text-4xl font-extrabold tracking-tight text-white tabular-nums">
                  {currentCountryClients.length > 0 ? `${operationalRate.toFixed(1)}%` : '0.0%'}
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-1">
                {(['Diario', 'Semanal', 'Mensual'] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setSelectedTrendPeriod(period)}
                    className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                      selectedTrendPeriod === period
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
                  {operationalDelta >= 0 ? '+' : ''}{operationalDelta.toFixed(1)}% vs. meta
                </span>
                <span className="mt-1 text-[11px] text-slate-400">Meta: {operationalTarget}%</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Actual</div>
                <div className="mt-2 text-2xl font-extrabold text-white tabular-nums">
                  {currentCountryClients.length > 0 ? `${operationalRate.toFixed(1)}%` : '0.0%'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Meta</div>
                <div className="mt-2 text-2xl font-extrabold text-blue-300 tabular-nums">{operationalTarget}%</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Variación</div>
                <div className={`mt-2 text-2xl font-extrabold ${operationalDelta >= 0 ? 'text-emerald-400' : 'text-red-400'} tabular-nums`}>
                  {operationalDelta >= 0 ? '+' : ''}{operationalDelta.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Tendencia</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleExportTrendExcel} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-200">Excel</button>
                  <button type="button" onClick={handlePrintPdfExport} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-200">PDF</button>
                </div>
              </div>

              <div className="h-28 w-full">
                <svg className="w-full h-full" viewBox="0 0 350 100" preserveAspectRatio="none">
                  <path d={trendPath} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  {trendValues.map((value, index) => {
                    const x = 18 + (index * 62);
                    const y = 88 - (value / 100) * 65;
                    return <circle key={`${selectedTrendPeriod}-${chartMonthLabels[index]}`} cx={x} cy={y} r={index === trendValues.length - 1 ? 6 : 4} fill={index === trendValues.length - 1 ? '#60a5fa' : '#3b82f6'} stroke="#0f172a" strokeWidth="2" />;
                  })}
                </svg>
              </div>

              <div className="flex justify-between text-[11px] font-mono text-slate-400 px-3">
                {chartMonthLabels.map((month, index) => (
                  <span key={month} className={index === chartMonthLabels.length - 1 ? 'text-blue-400 font-bold' : ''}>{month}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Recuperación Mensual de Cartera
                </h3>
                <div className="mt-2 text-[11px] text-slate-400">Monto recuperado de clientes gestionados durante el período</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleExportRecoveryExcel} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-semibold text-slate-200">Excel</button>
                <button type="button" onClick={handlePrintPdfExport} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-semibold text-slate-200">PDF</button>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-3 text-center text-[10px] text-slate-400 font-mono">
              {chartMonthRecovery.map((item) => (
                <div key={item.label}>
                  <div className="text-[10px]">{item.label}</div>
                  <div className={`mt-1 font-bold ${item.label === 'Jun' ? 'text-blue-300' : 'text-white'}`}>
                    ${item.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
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
