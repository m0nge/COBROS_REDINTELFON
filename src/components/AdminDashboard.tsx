import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Agent, Client, Country, CriticalClient, DynamicField, MessageScript, GestionAuditRecord } from '../types';
import { INITIAL_MESSAGE_SCRIPTS } from '../data/mockData';
import { ScriptsLibraryPanel } from './ScriptsLibraryPanel';
import { AgentDashboard } from './AgentDashboard';
import {
  getElSalvadorDateKey,
  getElSalvadorDateParts,
  getRecordDateKey,
  getWeekStartDateKey,
  shiftDateKey,
  mergeManagementRecords,
} from '../utils/gestionDates';
import { OPERATIONAL_DAYS_MAX } from '../utils/moraLogic';
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
  Sliders,
  CalendarDays,
  MessageSquareCode,
  Upload,
  Activity,
  History,
  Timer,
  PhoneCall,
  Check,
  AlertCircle,
  ExternalLink,
  Pencil,
  UserCheck,
  UserX,
} from 'lucide-react';
import { PortfolioUploadModal } from './PortfolioUploadModal';
import { AgentProfileEditor, type AgentProfileUpdates } from './AgentProfileEditor';
import { authenticatedApiFetch } from '../services/authService';

interface AdminDashboardProps {
  currentCountry: Country;
  agents: Agent[];
  agentRosterNotice?: string | null;
  clients: Client[];
  dynamicFields: DynamicField[];
  onUpdateDynamicFields: (fields: DynamicField[]) => void;
  onAddAgent: (agent: Omit<Agent, 'id' | 'assignedCount' | 'managedCount' | 'pendingCount' | 'effectivenessRate'>) => void;
  onDistributeCartera: () => void;
  criticalClients: CriticalClient[];
  onEscalateClient: (client: CriticalClient) => void;
  clientsPerDay?: number;
  onUpdateClientsPerDay?: (quota: number) => void;
  messageScripts?: MessageScript[];
  onUpdateMessageScripts?: (scripts: MessageScript[]) => void;
  onAssignPortfolioToAgent?: (agentId: string, assignedClients: Client[], replace: boolean) => void;
  onClearAgentManualAssignment?: (agentId: string) => void;
  onUpdateAgent?: (agentId: string, updates: AgentProfileUpdates) => Promise<Agent>;
  onSetAgentStatus?: (agentId: string, status: 'activo' | 'inactivo') => Promise<Agent>;
  onDeleteAgent?: (agentId: string) => Promise<void>;
  activeModule?: string;
  auditLog?: GestionAuditRecord[];
  onOpenGestionModal?: (client: Client) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentCountry,
  agents,
  agentRosterNotice,
  clients,
  dynamicFields,
  onUpdateDynamicFields,
  onAddAgent,
  onDistributeCartera,
  criticalClients,
  onEscalateClient,
  clientsPerDay = 40,
  onUpdateClientsPerDay,
  messageScripts = INITIAL_MESSAGE_SCRIPTS,
  onUpdateMessageScripts,
  onAssignPortfolioToAgent,
  onClearAgentManualAssignment,
  onUpdateAgent,
  onSetAgentStatus,
  onDeleteAgent,
  activeModule,
  auditLog = [],
  onOpenGestionModal,
}) => {
  // Daily Quota per Agent state (Default: 40 clientes/día)
  const [currentQuota, setCurrentQuota] = useState<number>(clientsPerDay);
  const [quotaSavedMsg, setQuotaSavedMsg] = useState<boolean>(false);

  // Scroll to anchor on activeModule change
  useEffect(() => {
    if (activeModule === 'inicio') {
      document.getElementById('inteligencia-negocio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (activeModule && ['equipo-cobro', 'constructor-bitacora', 'inteligencia-negocio', 'clientes-criticos', 'scripts-mensajes'].includes(activeModule)) {
      const el = document.getElementById(activeModule);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [activeModule]);

  // Active Admin Submodule / Tab
  const [adminViewTab, setAdminViewTab] = useState<'operacion' | 'scripts' | 'bitacora' | 'analitica'>('operacion');
  // Agent inspection modal state
  const [inspectedAgent, setInspectedAgent] = useState<Agent | null>(null);
  const [isAgentProfileEditorOpen, setIsAgentProfileEditorOpen] = useState(false);
  const [isAgentActionBusy, setIsAgentActionBusy] = useState(false);
  const [agentActionError, setAgentActionError] = useState('');
  const [inspectorSearch, setInspectorSearch] = useState<string>('');
  const [inspectedTab, setInspectedTab] = useState<'auditoria' | 'actividad' | 'cartera'>('actividad');
  const [auditDateFilter, setAuditDateFilter] = useState<'hoy' | 'semana' | 'todos'>('todos');
  const [auditChannelFilter, setAuditChannelFilter] = useState<string>('TODOS');
  const [auditSearchTerm, setAuditSearchTerm] = useState<string>('');

  // Main page audit section filter state
  const [globalAuditAgentId, setGlobalAuditAgentId] = useState<string>('TODOS');
  const [globalAuditDateFilter, setGlobalAuditDateFilter] = useState<'hoy' | 'semana' | 'todos'>('todos');
  const [globalAuditSearch, setGlobalAuditSearch] = useState<string>('');
  const currentMonthLabel = new Intl.DateTimeFormat('es-SV', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/El_Salvador',
  }).format(new Date());
  const adminMonthKey = getElSalvadorDateKey().slice(0, 7);
  const [monthlyResolvedCodes, setMonthlyResolvedCodes] = useState<string[]>([]);
  const [monthlyStateLoaded, setMonthlyStateLoaded] = useState(false);

  useEffect(() => {
    let isCurrentPeriod = true;
    setMonthlyStateLoaded(false);
    setMonthlyResolvedCodes([]);
    const params = new URLSearchParams({ pais: currentCountry, mes: adminMonthKey });
    authenticatedApiFetch(`/api/cartera/estado-mensual?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success || !Array.isArray(payload.states)) {
          throw new Error('MONTHLY_STATE_UNAVAILABLE');
        }
        if (!isCurrentPeriod) return;
        setMonthlyResolvedCodes(
          payload.states
            .filter((state: any) => state.pais === currentCountry && state.mes_periodo === adminMonthKey)
            .map((state: any) => String(state.codigo_cliente)),
        );
        setMonthlyStateLoaded(true);
      })
      .catch(() => {
        if (isCurrentPeriod) setMonthlyStateLoaded(false);
      });
    return () => {
      isCurrentPeriod = false;
    };
  }, [currentCountry, adminMonthKey]);

  // Portfolio Upload Modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTargetAgent, setUploadTargetAgent] = useState<Agent | null>(null);

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

  const handleSaveInspectedAgent = async (updates: AgentProfileUpdates) => {
    if (!inspectedAgent || !onUpdateAgent) throw new Error('La edición de perfiles no está disponible.');
    const previousCountry = inspectedAgent.country;
    const saved = await onUpdateAgent(inspectedAgent.id, updates);
    if (saved.country !== previousCountry) {
      setInspectedAgent(null);
    } else {
      setInspectedAgent(saved);
    }
    setIsAgentProfileEditorOpen(false);
    return saved;
  };

  const handleToggleInspectedAgent = async () => {
    if (!inspectedAgent || !onSetAgentStatus) return;
    setAgentActionError('');
    setIsAgentActionBusy(true);
    try {
      const nextStatus = inspectedAgent.status === 'activo' ? 'inactivo' : 'activo';
      const saved = await onSetAgentStatus(inspectedAgent.id, nextStatus);
      setInspectedAgent(saved);
    } catch (error) {
      setAgentActionError(error instanceof Error ? error.message : 'No se pudo cambiar el estado.');
    } finally {
      setIsAgentActionBusy(false);
    }
  };

  const handleDeleteInspectedAgent = async () => {
    if (!inspectedAgent || !onDeleteAgent) return;
    const confirmed = window.confirm(
      `¿Eliminar definitivamente el perfil de ${inspectedAgent.name}? Solo se permite si no tiene cartera asignada ni historial de gestiones.`,
    );
    if (!confirmed) return;

    setAgentActionError('');
    setIsAgentActionBusy(true);
    try {
      await onDeleteAgent(inspectedAgent.id);
      setInspectedAgent(null);
    } catch (error) {
      setAgentActionError(error instanceof Error ? error.message : 'No se pudo eliminar el perfil.');
    } finally {
      setIsAgentActionBusy(false);
    }
  };

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

  const activeAgentIds = countryAgents.filter((agent) => agent.status === 'activo').map((agent) => agent.id);
  const currentCountryClients = clients
    .filter((client) => client.country === currentCountry)
    .map((client) => {
      if (!monthlyStateLoaded) return client;
      if (monthlyResolvedCodes.includes(client.code)) return { ...client, state: 'Resuelto' as const };
      return client.state === 'Resuelto' ? { ...client, state: 'Pendiente' as const } : client;
    });
  const allAuditRecords = React.useMemo(() => {
    return mergeManagementRecords(auditLog || [], clients);
  }, [auditLog, clients]);
  const todayKey = getElSalvadorDateKey();
  const todayParts = getElSalvadorDateParts();
  const agentTodayGoal = todayParts.day <= OPERATIONAL_DAYS_MAX ? currentQuota : 0;
  const operationalClients = currentCountryClients.filter(
    (client) => !client.assignedAgentId || activeAgentIds.includes(client.assignedAgentId)
  );
  const managedCountryClients = operationalClients.filter((client) => client.state === 'Resuelto');
  const pendingCountryClients = currentCountryClients.filter(
    (client) =>
      (!client.assignedAgentId || activeAgentIds.includes(client.assignedAgentId))
      && (client.state === 'Pendiente' || client.state === 'No Contactado')
  );
  const evaluationBase = operationalClients;
  const operationalRate = evaluationBase.length > 0
    ? (managedCountryClients.length / evaluationBase.length) * 100
    : 0;
  const operationalAgents = countryAgents.filter((agent) => agent.status === 'activo');
  const getOperationalAgentId = (record: GestionAuditRecord) => {
    const agentById = operationalAgents.find((agent) => record.agentId && record.agentId === agent.id);
    if (agentById) return agentById.id;
    const normalizedName = (record.agentName || '').trim().toLocaleLowerCase();
    return operationalAgents.find((agent) => agent.name.trim().toLocaleLowerCase() === normalizedName)?.id || '';
  };
  const getUniqueLeadKeys = (records: GestionAuditRecord[]) => new Set(
    records.flatMap((record) => {
      const agentId = getOperationalAgentId(record);
      return agentId && record.clientCode ? [`${agentId}:${record.clientCode}`] : [];
    })
  );
  const todayLeadKeys = getUniqueLeadKeys(
    allAuditRecords.filter((record) => record.country === currentCountry && getRecordDateKey(record) === todayKey)
  );
  const actualLeadsPerAgent = operationalAgents.length > 0
    ? todayLeadKeys.size / operationalAgents.length
    : 0;
  const operationalTarget = currentQuota;
  const operationalDelta = actualLeadsPerAgent - operationalTarget;
  const operationalDeltaPercent = operationalTarget > 0
    ? (operationalDelta / operationalTarget) * 100
    : 0;
  const weekStartKey = getWeekStartDateKey(todayKey);
  const elapsedOperationalDates = Array.from({ length: 7 }, (_, index) => shiftDateKey(weekStartKey, index))
    .filter((dateKey) => dateKey <= todayKey)
    .filter((dateKey) => Number(dateKey.slice(8, 10)) <= OPERATIONAL_DAYS_MAX);
  const weekRecords = allAuditRecords.filter((record) => {
    const dateKey = getRecordDateKey(record);
    return record.country === currentCountry && Boolean(dateKey) && dateKey! >= weekStartKey && dateKey! <= todayKey;
  });
  const weeklyLeadCount = getUniqueLeadKeys(weekRecords).size;
  const weeklyLeadGoal = operationalTarget * operationalAgents.length * elapsedOperationalDates.length;
  const weeklyLeadRate = weeklyLeadGoal > 0 ? Number(((weeklyLeadCount / weeklyLeadGoal) * 100).toFixed(1)) : 0;
  const dailyTrendDates = Array.from({ length: 5 }, (_, index) => shiftDateKey(weekStartKey, index))
    .filter((dateKey) => dateKey <= todayKey);

  // Real trend calculations for Diario, Semanal, Mensual
  const trendConfig: Record<
    'Diario' | 'Semanal' | 'Mensual',
    { labels: string[]; values: number[]; subtitle: string; periodName: string }
  > = {
    Diario: {
      periodName: 'Día',
      labels: dailyTrendDates.map((dateKey) => new Intl.DateTimeFormat('es-SV', {
        weekday: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${dateKey}T12:00:00Z`)).replace(/\./g, '')),
      values: dailyTrendDates.map((dateKey) => {
        const dateRecords = allAuditRecords.filter(
          (record) => record.country === currentCountry && getRecordDateKey(record) === dateKey
        );
        const target = operationalTarget * operationalAgents.length;
        return target > 0 ? Number(((getUniqueLeadKeys(dateRecords).size / target) * 100).toFixed(1)) : 0;
      }),
      subtitle: `Leads únicos por día frente a la meta de ${operationalTarget} por agente.`,
    },
    Mensual: {
      periodName: 'Mes',
      labels: [currentMonthLabel],
      values: [Number(operationalRate.toFixed(1))],
      subtitle: `Efectividad actual de cartera: ${managedCountryClients.length} de ${evaluationBase.length} clientes resueltos (${operationalRate.toFixed(1)}%).`,
    },
    Semanal: {
      periodName: 'Semana',
      labels: ['Semana actual'],
      values: [weeklyLeadRate],
      subtitle: `${weeklyLeadCount} leads únicos de ${weeklyLeadGoal} de meta acumulada esta semana.`,
    },
  };

  const activeTrend = trendConfig[selectedTrendPeriod];
  const trendLabels = activeTrend.labels;
  const trendValues = activeTrend.values;
  const maxSvgWidth = 350;
  const paddingX = 25;
  const usableWidth = maxSvgWidth - paddingX * 2;
  const stepX = trendLabels.length > 1 ? usableWidth / (trendLabels.length - 1) : usableWidth;

  const trendPath = trendValues
    .map((value, index) => {
      const x = paddingX + index * stepX;
      // y ranges from 88 (0%) to 20 (100%)
      const y = 88 - (Math.min(100, Math.max(0, value)) / 100) * 68;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  // Real Quarterly Debt & Recovery breakdown from SAP
  const quartersData = ['Q1', 'Q2', 'Q3', 'Q4'].map((q, idx) => {
      const qClients = currentCountryClients.filter((c) => {
        if (c.debtVerified === false) return false;
      const d = new Date(c.dueDate || c.invoiceDate || '2026-10-01');
      const m = Number.isNaN(d.getTime()) ? 9 : d.getMonth();
      const qIndex = Math.floor(m / 3);
      return qIndex === idx;
    });
    const totalDebtQ = qClients.filter((c) => c.debtVerified !== false).reduce((sum, c) => sum + (c.totalDebt || 0), 0);
    const resolvedDebtQ = qClients.filter((c) => c.state === 'Resuelto' && c.debtVerified !== false).reduce((sum, c) => sum + (c.totalDebt || 0), 0);
    const pendingDebtQ = qClients.filter((c) => c.state !== 'Resuelto' && c.debtVerified !== false).reduce((sum, c) => sum + (c.totalDebt || 0), 0);
    const resolvedCountQ = qClients.filter((c) => c.state === 'Resuelto').length;
    const pendingCountQ = qClients.filter((c) => c.state !== 'Resuelto').length;
    return {
      quarter: q,
      totalDebt: totalDebtQ,
      resolvedDebt: resolvedDebtQ,
      pendingDebt: pendingDebtQ,
      resolvedCount: resolvedCountQ,
      pendingCount: pendingCountQ,
    };
  });
  const maxQuarterDebt = Math.max(...quartersData.map((d) => d.totalDebt), 1);

  // Real Mora Range distribution metrics
  const verifiedMoraClients = currentCountryClients.filter((c) => c.debtVerified !== false);
  const totalMoraClients = verifiedMoraClients.length || 1;
  const count0_30 = verifiedMoraClients.filter((c) => c.moraRange === '0-30').length;
  const count31_60 = verifiedMoraClients.filter((c) => c.moraRange === '31-60').length;
  const count61_90 = verifiedMoraClients.filter((c) => c.moraRange === '61-90').length;
  const count91_120 = verifiedMoraClients.filter((c) => c.moraRange === '91-120').length;
  const count120 = verifiedMoraClients.filter((c) => c.moraRange === '120+').length;

  const pct0_30 = Number(((count0_30 / totalMoraClients) * 100).toFixed(2));
  const pct31_60 = Number(((count31_60 / totalMoraClients) * 100).toFixed(2));
  const pct61_90 = Number(((count61_90 / totalMoraClients) * 100).toFixed(2));
  const pct91_120 = Number(((count91_120 / totalMoraClients) * 100).toFixed(2));
  const pct120 = Number(((count120 / totalMoraClients) * 100).toFixed(2));

  const offset0_30 = 0;
  const offset31_60 = -pct0_30;
  const offset61_90 = -(pct0_30 + pct31_60);
  const offset91_120 = -(pct0_30 + pct31_60 + pct61_90);
  const offset120 = -(pct0_30 + pct31_60 + pct61_90 + pct91_120);

  // Real Monthly Recovery calculation
  const chartMonthLabels = ['May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct'];
  const chartMonthRecovery = chartMonthLabels.map((label) => {
    const isCurrent = label === 'Oct';
    const amount = isCurrent
      ? currentCountryClients.filter((c) => c.state === 'Resuelto').reduce((sum, c) => sum + (c.totalDebt || 0), 0)
      : 0;
    const resolvedCount = isCurrent ? managedCountryClients.length : 0;
    return {
      label,
      amount,
      resolvedCount,
    };
  });

  const exportWorkbook = (title: string, rows: Array<Array<string | number>>, headers: string[]) => {
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, title);
    XLSX.writeFile(workbook, `${title}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportTrendExcel = () => {
    exportWorkbook(
      `Tendencia_Efectividad_${selectedTrendPeriod}_${currentCountry}`,
      trendValues.map((value, index) => [trendLabels[index], `${value.toFixed(1)}%`]),
      [activeTrend.periodName, 'Efectividad %']
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
          c.debtVerified === false ? 'Pendiente de consultar en SAN' : Number(c.daysArrears || 0),
          c.debtVerified === false ? 'Pendiente de consultar en SAN' : c.moraRange || '0-30',
          c.debtVerified === false ? 'Pendiente de consultar en SAN' : Number(c.totalDebt || 0),
          c.state || 'Pendiente',
          c.priority || 'Normal',
          assigned?.name || '',
          c.scheduledTime || '',
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

  const handleExportAuditXLSX = (records: GestionAuditRecord[], titleName?: string) => {
    const rows = records.map((r, idx) => ({
      '#': idx + 1,
      'Hora Exacta': r.time || 'N/A',
      'Fecha': r.date || 'N/A',
      'Agente': r.agentName || 'N/A',
      'PBX': r.pbxExtension || '',
      'Cód. Cliente': r.clientCode,
      'Cliente Real': r.clientName,
      'Canal': r.channel,
      'Duración': r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` : 'N/A',
      'Contacto Exitoso': r.contactSuccess,
      'Acuerdo': r.agreement,
      'Monto Pactado ($)': r.committedAmount || 0,
      'Fecha Límite': r.deadlineDate || 'N/A',
      'Observaciones': r.observations || '',
      'Dictamen IA': r.aiVerdict || '',
      'Score IA': r.aiScore ?? '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria_Gestiones');
    XLSX.writeFile(
      wb,
      `Auditoria_Gestiones_${titleName ? titleName.replace(/\s+/g, '_') : 'General'}_${new Date().toISOString().split('T')[0]}.xlsx`
    );
  };

  // Inspector clients for selected agent
  const inspectedAgentClients = inspectedAgent
    ? clients.filter(
        (c) =>
          c.country === inspectedAgent.country &&
          c.assignedAgentId === inspectedAgent.id &&
          (inspectorSearch === '' ||
            (c.name || '').toLowerCase().includes(inspectorSearch.toLowerCase()) ||
            (c.code || '').toLowerCase().includes(inspectorSearch.toLowerCase()))
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

        {/* ========================================================================= */}
        {/* CUADRO DE CAPACIDAD DE ASIGNACIÓN DIARIA DE CLIENTES (DÍAS 1 AL 22) */}
        {/* ========================================================================= */}
        <div className="mb-8 p-5 rounded-2xl bg-gradient-to-r from-blue-950/70 via-slate-900 to-indigo-950/70 border border-blue-500/40 shadow-xl shadow-blue-950/30">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  <CalendarDays className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Capacidad de Asignación Diaria por Agente (Días 1 al 22 del Mes)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-700/50 text-[10px] font-mono font-bold">
                  Ventana 1-22 · Cobranza Intensiva
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                Define cuántos clientes gestionará cada agente por día (por defecto: <strong>40 al día</strong>). La cobranza se distribuye estrictamente entre el <strong>1 y el 22 del mes</strong> ({currentQuota * 22} llamadas/mes por agente). Si la cantidad de clientes es menor, el sistema planifica reintentos escalonados (<span className="text-blue-300 font-mono">1ª llamada, 2ª llamada refuerzo</span>) asegurando siempre la meta diaria de llamadas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 bg-slate-950/80 px-3.5 py-2 rounded-xl border border-slate-700">
                <label className="text-xs font-semibold text-slate-300">Clientes/Día:</label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={currentQuota}
                  onChange={(e) => setCurrentQuota(Math.max(5, Math.min(100, Number(e.target.value) || 40)))}
                  className="w-16 px-2 py-1 text-sm font-mono font-bold text-white bg-slate-900 rounded-lg border border-slate-600 text-center focus:border-blue-400 outline-none"
                />
                <span className="text-[11px] text-slate-400 font-mono">
                  × 22 días = <strong className="text-blue-300">{currentQuota * 22}</strong> llamadas
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (onUpdateClientsPerDay) onUpdateClientsPerDay(currentQuota);
                  onDistributeCartera();
                  setQuotaSavedMsg(true);
                  setTimeout(() => setQuotaSavedMsg(false), 4500);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Aplicar y Recalcular Agenda (1 al 22)</span>
              </button>
            </div>
          </div>

          {quotaSavedMsg && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>¡Capacidad configurada a {currentQuota} clientes/día!</strong> La agenda diaria del 1 al 22 fue recalculada e incluye reintentos (2ª llamada) e historial reciente.
              </span>
            </div>
          )}
        </div>

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

            {agentRosterNotice && (
              <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
                {agentRosterNotice}
              </div>
            )}

            <div className="space-y-3">
              {countryAgents.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                  No hay perfiles de agente cargados desde Supabase para {currentCountry}.
                </div>
              ) : (
                countryAgents.map((ag) => {
                  const agentClients = clients.filter(
                    (client) => client.country === ag.country && client.assignedAgentId === ag.id
                  );
                  const assignedCount = agentClients.length;
                  const recordsForAgent = allAuditRecords.filter((record) =>
                    record.agentId
                      ? record.agentId === ag.id
                      : (record.agentName || '').trim().toLocaleLowerCase() === ag.name.trim().toLocaleLowerCase()
                  );
                  const managedCount = new Set(
                    recordsForAgent
                      .map((record) => record.clientCode)
                      .filter((code) => agentClients.some((client) => client.code === code))
                  ).size;
                  const todayManagementCount = recordsForAgent.filter(
                    (record) => getRecordDateKey(record) === todayKey
                  ).length;
                  const todayPerformance = agentTodayGoal > 0
                    ? Number(((todayManagementCount / agentTodayGoal) * 100).toFixed(1))
                    : null;

                  const hasManual = clients.some(
                    (c) => c.country === ag.country && c.assignedAgentId === ag.id && c.isManualAssignment
                  );

                  return (
                    <div
                      key={ag.id}
                      onClick={() => {
                        setInspectedAgent(ag);
                        setInspectedTab('actividad');
                      }}
                      className="p-4 rounded-xl bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-blue-500/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all cursor-pointer group shadow-sm"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="relative">
                          <img
                            src={ag.avatarUrl}
                            alt={ag.name}
                            className="w-12 h-12 rounded-full object-cover border-2 border-slate-700 group-hover:border-blue-400 transition-colors"
                          />
                          <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-slate-900 ${
                            ag.status === 'activo' ? 'bg-emerald-500' : 'bg-slate-500'
                          }`} />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-100 flex flex-wrap items-center gap-2 group-hover:text-blue-300 transition-colors">
                            <span>{ag.name}</span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/50">
                              {ag.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                              ag.status === 'activo'
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                : 'bg-slate-800 text-slate-300 border-slate-600'
                            }`}>
                              {ag.status === 'activo' ? 'Activo' : 'Inactivo'}
                            </span>
                            {hasManual && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                                Cartera Manual Asignada
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1 font-mono font-medium text-blue-400 bg-blue-950/40 px-1.5 py-0.2 rounded border border-blue-800/40">
                              <Phone className="w-3 h-3 text-blue-400" />
                               PBX: {ag.pbxExtension || '—'}
                            </span>
                            <span className="font-mono text-slate-300">
                              {ag.phone}
                            </span>
                          </div>
                          {ag.email && (
                            <div className="text-[11px] text-slate-400 mt-1">{ag.email}</div>
                          )}
                          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                            <span>Asignados: <strong className="text-slate-200">{assignedCount}</strong></span>
                            <span>·</span>
                            <span>Con gestión registrada: <strong className="text-emerald-400">{managedCount}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUploadTargetAgent(ag);
                            setIsUploadModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/50 text-xs font-bold transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                          title="Subir cartera individual (Excel o PDF) para este agente"
                        >
                          <Upload className="w-3.5 h-3.5 text-blue-400" />
                          <span>Subir Cartera</span>
                        </button>

                        <div className="text-right pl-3 border-l border-slate-800 space-y-0.5">
                          <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                            Rendimiento Hoy
                          </div>
                          <div className="text-base font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-emerald-400 tabular-nums">
                            {todayPerformance === null ? '—' : `${todayPerformance}%`}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {agentTodayGoal > 0
                              ? `${todayManagementCount}/${agentTodayGoal} gestiones`
                              : 'Fuera de la ventana operativa'}
                          </div>
                          <div className="text-[10px] text-blue-400 font-medium flex items-center gap-1 justify-end group-hover:translate-x-0.5 transition-transform pt-1">
                            <span>Auditoría en Vivo</span>
                            <ChevronRight className="w-3 h-3" />
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

      {/* ---------------- SECCIÓN: BIBLIOTECA DE SCRIPTS DE MENSAJES PERSONALIZADOS ---------------- */}
      <section id="scripts-mensajes" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <MessageSquareCode className="w-4 h-4 text-blue-400" />
              <span>Plantillas Personalizadas & Variables de Cliente</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Biblioteca de Scripts de Mensajes
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Crea y edita scripts de cobranza usando cajas de variables dinámicas ({'{nombre_cliente}'}, {'{monto_total}'}, {'{monto_mes}'}, {'{dias_mora}'}, {'{facturas_pendientes_count}'}, {'{fecha_corte}'}, etc.). El agente podrá buscar en esta biblioteca dentro de la gestión y copiar el mensaje con datos reales reemplazados al instante.
            </p>
          </div>
        </div>

        <ScriptsLibraryPanel
          scripts={messageScripts}
          onSaveScripts={onUpdateMessageScripts || (() => {})}
          sampleClient={clients[0]}
          isAdmin={true}
        />
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
          {/* Card 1: Recuperación Mensual de Cartera (SAP 100% Real) - Altamente Visual */}
          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Recuperación Mensual de Cartera (100% Real)
                </h3>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Monto y efectividad de cobranza real en {currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-emerald-950/70 text-emerald-300 border border-emerald-800/60">
                  {currentCountry === 'SV' ? '$' : 'Q'}{chartMonthRecovery.find(m => m.label === 'Oct')?.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={handleExportRecoveryExcel} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer" title="Exportar a Excel">Excel</button>
                  <button type="button" onClick={handlePrintPdfExport} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer" title="Exportar a PDF">PDF</button>
                </div>
              </div>
            </div>

            {/* Visual Bar Graph */}
            <div className="h-44 flex items-end justify-between gap-3 pt-3 px-3 pb-2 border-b border-slate-800 font-mono text-xs">
              {chartMonthRecovery.map((item) => {
                const maxAmt = Math.max(...chartMonthRecovery.map((d) => d.amount), 5000);
                const heightPct = item.amount > 0
                  ? Math.max(18, Math.min(100, Math.round((item.amount / maxAmt) * 100)))
                  : 8;
                const isCurrent = item.label === 'Oct';
                const formattedAmt = currentCountry === 'SV'
                  ? `$${(item.amount / 1000).toFixed(1)}K`
                  : `Q${(item.amount / 1000).toFixed(1)}K`;

                return (
                  <div key={item.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                    <div className={`text-[10px] font-bold font-mono transition-colors ${item.amount > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                      {item.amount > 0 ? formattedAmt : '$0'}
                    </div>

                    <div className="w-full flex items-end justify-center h-28">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full max-w-[42px] rounded-t-lg transition-all duration-300 relative ${
                          isCurrent && item.amount > 0
                            ? 'bg-gradient-to-t from-emerald-600 via-teal-500 to-cyan-400 shadow-lg shadow-emerald-500/25 group-hover:scale-105'
                            : 'bg-slate-800/80 group-hover:bg-slate-700/80'
                        }`}
                        title={`${item.label} 2026: ${currentCountry === 'SV' ? '$' : 'Q'}${item.amount.toLocaleString()} (${item.resolvedCount} clientes resueltos)`}
                      >
                        {item.amount > 0 && (
                          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-cyan-300 shadow-sm shadow-cyan-300"></div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-center">
                      <span className={`text-xs font-semibold ${isCurrent ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                        {item.label}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {item.resolvedCount > 0 ? `${item.resolvedCount} res.` : '0'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom summary KPIs inside the card */}
            <div className="grid grid-cols-3 gap-2 pt-3 text-center text-xs">
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Recuperado</span>
                <span className="text-sm font-black font-mono text-emerald-400">
                  {currentCountry === 'SV' ? '$' : 'Q'}{(chartMonthRecovery.find(m => m.label === 'Oct')?.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Resueltos</span>
                <span className="text-sm font-black font-mono text-blue-400">
                  {managedCountryClients.length} de {currentCountryClients.length}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Efectividad</span>
                <span className="text-sm font-black font-mono text-white">
                  {operationalRate.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Distribución de Cartera por Rango de Mora (SAP) */}
          <div className="lg:col-span-6 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-4">
              Distribución de Cartera por Rango de Mora (SAP 100% Real)
            </h3>

            <div className="flex flex-col sm:flex-row items-center justify-around gap-6">
              <div className="relative w-36 h-36 shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  {pct0_30 > 0 && (
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray={`${pct0_30} ${100 - pct0_30}`} strokeDashoffset={offset0_30} />
                  )}
                  {pct31_60 > 0 && (
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#f97316" strokeWidth="4" strokeDasharray={`${pct31_60} ${100 - pct31_60}`} strokeDashoffset={offset31_60} />
                  )}
                  {pct61_90 > 0 && (
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#eab308" strokeWidth="4" strokeDasharray={`${pct61_90} ${100 - pct61_90}`} strokeDashoffset={offset61_90} />
                  )}
                  {pct91_120 > 0 && (
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#ea580c" strokeWidth="4" strokeDasharray={`${pct91_120} ${100 - pct91_120}`} strokeDashoffset={offset91_120} />
                  )}
                  {pct120 > 0 && (
                    <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#ef4444" strokeWidth="4" strokeDasharray={`${pct120} ${100 - pct120}`} strokeDashoffset={offset120} />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xs font-mono font-bold text-white">{currentCountryClients.length}</span>
                  <span className="text-[10px] text-slate-400">Clientes SAP</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs font-medium w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-slate-300">0-30 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {count0_30} <span className="text-[10px] text-slate-500 font-normal">({pct0_30}%)</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-400" />
                  <span className="text-slate-300">31-60 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {count31_60} <span className="text-[10px] text-slate-500 font-normal">({pct31_60}%)</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <span className="text-slate-300">61-90 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {count61_90} <span className="text-[10px] text-slate-500 font-normal">({pct61_90}%)</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-600" />
                  <span className="text-slate-300">91-120 días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {count91_120} <span className="text-[10px] text-slate-500 font-normal">({pct91_120}%)</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="text-slate-300">120+ días</span>
                  <span className="font-mono text-slate-400 ml-auto font-bold">
                    {count120} <span className="text-[10px] text-slate-500 font-normal">({pct120}%)</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Tasa de Efectividad Operativa Real (Diario / Mensual / Semanal) */}
          <div className="lg:col-span-12 p-4 rounded-xl bg-slate-900/70 border border-slate-800">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Tasa de Efectividad Operativa Real ({selectedTrendPeriod === 'Diario' ? 'Por Día' : (selectedTrendPeriod === 'Mensual' ? 'Por Mes' : 'Por Semana')})
                </h3>
                <div className="mt-1 text-xs text-slate-400">
                  {activeTrend.subtitle}
                </div>
                <div className="mt-2 text-4xl font-extrabold tracking-tight text-white tabular-nums">
                  {currentCountryClients.length > 0 ? `${operationalRate.toFixed(1)}%` : '0.0%'}
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-1">
                {(['Diario', 'Mensual', 'Semanal'] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setSelectedTrendPeriod(period)}
                    className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                      selectedTrendPeriod === period
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Por {period === 'Diario' ? 'Día' : (period === 'Mensual' ? 'Mes' : 'Semana')}
                  </button>
                ))}
              </div>

              <div className="flex flex-col items-end">
                <span className={`text-xs font-bold ${operationalDelta >= 0 ? 'text-emerald-400' : 'text-red-400'} flex items-center gap-1 justify-end`}>
                  <TrendingUp className="w-3.5 h-3.5" />
                  {operationalDelta >= 0 ? '+' : ''}{operationalDelta.toFixed(1)} leads/agente vs. meta
                </span>
                <span className="mt-1 text-[11px] text-slate-400">Meta operativa: {operationalTarget} leads/agente/día</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Actual (Cartera Resuelta)</div>
                <div className="mt-2 text-2xl font-extrabold text-white tabular-nums">
                  {currentCountryClients.length > 0 ? `${operationalRate.toFixed(1)}%` : '0.0%'}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {managedCountryClients.length} de {evaluationBase.length} clientes resueltos
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Meta Operativa</div>
                <div className="mt-2 text-2xl font-extrabold text-blue-300 tabular-nums">{operationalTarget} leads</div>
                <div className="text-[11px] text-slate-400 mt-1">Objetivo diario por agente</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Variación diaria real</div>
                <div className={`mt-2 text-2xl font-extrabold ${operationalDelta >= 0 ? 'text-emerald-400' : 'text-red-400'} tabular-nums`}>
                  {operationalDelta >= 0 ? '+' : ''}{operationalDelta.toFixed(1)} leads
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {actualLeadsPerAgent.toFixed(1)} leads/agente · {operationalDeltaPercent >= 0 ? '+' : ''}{operationalDeltaPercent.toFixed(1)}% vs. meta
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-300">
                <div className="flex items-center gap-2">
                  <span>Tendencia ({selectedTrendPeriod === 'Diario' ? 'Por Día' : (selectedTrendPeriod === 'Mensual' ? 'Por Mes' : 'Por Semana')})</span>
                  <span className="text-[10px] font-normal text-slate-400">· Datos 100% reales</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleExportTrendExcel} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer">Excel</button>
                  <button type="button" onClick={handlePrintPdfExport} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer">PDF</button>
                </div>
              </div>

              <div className="h-28 w-full">
                <svg className="w-full h-full" viewBox="0 0 350 100" preserveAspectRatio="none">
                  {/* Baseline grid */}
                  <line x1="20" y1="88" x2="330" y2="88" stroke="#334155" strokeWidth="0.8" strokeDasharray="3 3" />
                  <line x1="20" y1="54" x2="330" y2="54" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2 2" />
                  <line x1="20" y1="20" x2="330" y2="20" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2 2" />

                  {/* Path */}
                  <path d={trendPath} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  {trendValues.map((value, index) => {
                    const x = paddingX + index * stepX;
                    const y = 88 - (Math.min(100, Math.max(0, value)) / 100) * 68;
                    const isLast = index === trendValues.length - 1;
                    return (
                      <g key={`${selectedTrendPeriod}-${trendLabels[index]}`}>
                        <circle cx={x} cy={y} r={isLast ? 6 : 4} fill={value > 0 ? (isLast ? '#60a5fa' : '#3b82f6') : '#64748b'} stroke="#0f172a" strokeWidth="2" />
                        <text x={x} y={y - 10} textAnchor="middle" fill={value > 0 ? '#93c5fd' : '#64748b'} fontSize="9" fontFamily="monospace" fontWeight="bold">
                          {value.toFixed(1)}%
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="flex justify-between text-[11px] font-mono text-slate-400 px-3 mt-1">
                {trendLabels.map((lbl, index) => (
                  <span key={lbl} className={index === trendLabels.length - 1 ? 'text-blue-400 font-bold' : ''}>
                    {lbl}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Clientes Críticos 120+ días */}
          <div id="clientes-criticos" className="lg:col-span-12 p-4 rounded-xl bg-red-950/30 border border-red-800/60 shadow-lg shadow-red-950/40 relative">
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
                         {client.debtVerified === false ? 'Pendiente SAN' : `$${client.totalDebt.toLocaleString('en-US')}`}
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

      {/* La auditoría detallada queda dentro de la vista individual de cada agente. */}
      {activeModule === 'auditoria-gestiones' && (
      <section id="auditoria-gestiones" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>Auditoría de Gestiones en Tiempo Real · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Auditoría de Actividad por Agente</span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-800">
                Horas Exactas (hh:mm:ss)
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Supervisa con precisión de segundos las horas exactas en que cada agente gestionó a cada cliente, qué canal utilizó, duración de llamada, acuerdos pactados y observaciones de la bitácora.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleExportAuditXLSX(allAuditRecords, 'Auditoria_General')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-900/30 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Exportar Auditoría a Excel</span>
            </button>
          </div>
        </div>

        {/* Global Audit Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Filtrar por Agente:</label>
            <select
              value={globalAuditAgentId}
              onChange={(e) => setGlobalAuditAgentId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl glass-input bg-slate-900 font-medium text-slate-200"
            >
              <option value="TODOS">Todos los Agentes ({allAuditRecords.length} gestiones)</option>
              {countryAgents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                   {ag.name} (PBX: {ag.pbxExtension || '—'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Período de Fecha:</label>
            <div className="grid grid-cols-3 gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800 text-xs">
              {(['todos', 'hoy', 'semana'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setGlobalAuditDateFilter(p)}
                  className={`py-1 rounded-lg font-semibold capitalize cursor-pointer transition-colors ${
                    globalAuditDateFilter === p
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p === 'todos' ? 'Histórico' : p === 'hoy' ? 'Hoy' : '7 días'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Buscar por Cliente / Código:</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Ej: CL003300, Alcaldía..."
                value={globalAuditSearch}
                onChange={(e) => setGlobalAuditSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl glass-input text-slate-200"
              />
            </div>
          </div>
        </div>

        {/* Audit Log Table */}
        {(() => {
          const filteredGlobal = allAuditRecords.filter((r) => {
            if (globalAuditAgentId !== 'TODOS') {
              const selectedAgent = agents.find((agent) => agent.id === globalAuditAgentId);
              const matchesAgent = r.agentId
                ? r.agentId === globalAuditAgentId
                : (r.agentName || '').trim().toLocaleLowerCase() === (selectedAgent?.name || '').trim().toLocaleLowerCase();
              if (!matchesAgent) return false;
            }
            const recordDateKey = getRecordDateKey(r);
            if (globalAuditDateFilter === 'hoy') {
              if (recordDateKey !== todayKey) return false;
            }
            if (globalAuditDateFilter === 'semana') {
              const weekStartKey = getWeekStartDateKey(todayKey);
              if (!recordDateKey || recordDateKey < weekStartKey || recordDateKey > todayKey) return false;
            }
            if (globalAuditSearch.trim()) {
              const q = globalAuditSearch.toLowerCase();
              return (
                (r.clientCode || '').toLowerCase().includes(q) ||
                (r.clientName || '').toLowerCase().includes(q) ||
                (r.observations || '').toLowerCase().includes(q)
              );
            }
            return true;
          });

          return (
            <div className="overflow-x-auto rounded-xl border border-slate-800 shadow-inner">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Hora Exacta</th>
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3">Agente</th>
                    <th className="py-3 px-3 font-mono">Cód. Cliente</th>
                    <th className="py-3 px-3">Cliente Real</th>
                    <th className="py-3 px-3">Canal</th>
                    <th className="py-3 px-3">Duración</th>
                    <th className="py-3 px-3">Contacto</th>
                    <th className="py-3 px-3">Acuerdo</th>
                    <th className="py-3 px-3 text-right">Monto</th>
                    <th className="py-3 px-3">Observaciones</th>
                    <th className="py-3 px-3 text-center">IA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredGlobal.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-500">
                        No hay gestiones registradas que coincidan con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredGlobal.map((r, idx) => (
                      <tr key={r.id || idx} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono font-bold text-blue-400 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>{r.time}</span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                          {r.date}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-200">
                          <span className="font-semibold">{r.agentName}</span>
                          <span className="block text-[10px] text-slate-400 font-mono">Ext. {r.pbxExtension || '1021'}</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-300 whitespace-nowrap">
                          {r.clientCode}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200 font-medium truncate max-w-xs">
                          {r.clientName}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                            {r.channel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-400">
                          {r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` : 'N/A'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            (r.contactSuccess || '').toLowerCase().includes('sí') || (r.contactSuccess || '').toLowerCase().includes('si')
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                              : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                          }`}>
                            {r.contactSuccess}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/70 text-blue-300 border border-blue-800">
                            {r.agreement}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                          {r.committedAmount ? `$${Number(r.committedAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 text-xs truncate max-w-xs" title={r.observations}>
                          {r.observations}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800">
                            {r.aiScore == null ? 'No registrado' : `✓ ${r.aiScore}%`}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}
      </section>
      )}

      {/* MODAL DE SUPERVISIÓN DETALLADA Y AUDITORÍA DE AGENTE */}
      {inspectedAgent && (() => {
        const agentAuditRecords = allAuditRecords.filter(
          (r) =>
            r.agentId === inspectedAgent.id ||
            (r.agentName || '').trim().toLocaleLowerCase() === (inspectedAgent.name || '').trim().toLocaleLowerCase()
        );

        const agentDailyGoal = agentTodayGoal;
        const agentTodayAudit = agentAuditRecords.filter((record) => getRecordDateKey(record) === todayKey);
        const agentDailyResolved = agentTodayAudit.length;
        const agentDailyPct = agentDailyGoal > 0
          ? Number(((agentDailyResolved / agentDailyGoal) * 100).toFixed(1))
          : null;
        const agentManagedClientCount = inspectedAgentClients.filter((client) => client.state === 'Resuelto').length;
        const portfolioEffectiveness = inspectedAgentClients.length > 0
          ? ((agentManagedClientCount / inspectedAgentClients.length) * 100).toFixed(1)
          : '0.0';
        const agentTotalDebt = inspectedAgentClients.reduce((sum, c) => sum + (Number(c.totalDebt) || 0), 0);
        const agentTotalAgreed = agentAuditRecords.reduce((sum, r) => sum + (Number(r.committedAmount) || 0), 0);

        const promisesCount = agentAuditRecords.filter((r) => (r.agreement || '').toLowerCase().includes('promesa') || (r.agreement || '').toLowerCase().includes('negociación')).length;

        // Filtered audit list for modal
        const filteredAgentAudit = agentAuditRecords.filter((r) => {
          const recordDateKey = getRecordDateKey(r);
          if (auditDateFilter === 'hoy') {
            if (recordDateKey !== todayKey) return false;
          }
          if (auditDateFilter === 'semana') {
            const weekStartKey = getWeekStartDateKey(todayKey);
            if (!recordDateKey || recordDateKey < weekStartKey || recordDateKey > todayKey) return false;
          }
          if (auditChannelFilter !== 'TODOS' && r.channel !== auditChannelFilter) return false;
          if (auditSearchTerm.trim()) {
            const q = auditSearchTerm.toLowerCase();
            return (
              (r.clientCode || '').toLowerCase().includes(q) ||
              (r.clientName || '').toLowerCase().includes(q) ||
              (r.observations || '').toLowerCase().includes(q)
            );
          }
          return true;
        });

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md">
            <div className="w-full max-w-6xl rounded-2xl glass-panel border border-slate-700 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
              {/* Header Inspector */}
              <div className="p-5 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between shrink-0">
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
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-mono">
                         PBX: {inspectedAgent.pbxExtension || '—'}
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

              {/* Metrics cards of this agent (Including BIG Daily Percentage) */}
              <div className="p-5 bg-slate-950/40 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
                {/* Card 1: Rendimiento Diario / Progreso de Hoy (% GRANDE EN LA ESQUINA) */}
                <div className="p-3.5 rounded-xl bg-gradient-to-br from-purple-950/50 via-slate-900/90 to-slate-900 border border-purple-500/40 shadow-lg shadow-purple-950/20 relative overflow-hidden flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] text-purple-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                       Progreso de Hoy
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-purple-950 text-purple-300 border border-purple-800">
                      Variable Diaria
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between mt-1">
                    <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-300 to-emerald-400">
                      {agentDailyPct === null ? '—' : `${agentDailyPct}%`}
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-white">
                        {agentDailyGoal > 0
                          ? <>{agentDailyResolved} <span className="text-slate-400 font-normal">/ {agentDailyGoal}</span></>
                          : 'Fuera de agenda'}
                      </span>
                      <span className="block text-[10px] text-slate-400">turnos</span>
                    </div>
                  </div>

                  <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div
                      style={{ width: `${agentDailyPct === null ? 0 : Math.min(100, Math.max(0, agentDailyPct))}%` }}
                      className="bg-gradient-to-r from-purple-400 to-emerald-400 h-full rounded-full transition-all"
                    ></div>
                  </div>
                </div>

                {/* Card 2: Efectividad Cartera General */}
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Efectividad Cartera</div>
                  <div className="text-2xl font-black font-mono text-blue-400 mt-1">
                    {portfolioEffectiveness}%
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    {agentManagedClientCount} de {inspectedAgentClients.length} clientes resueltos
                  </div>
                </div>

                {/* Card 3: Total Deuda en Cartera */}
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Cartera Asignada</div>
                  <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
                    ${agentTotalDebt.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    {inspectedAgentClients.length} clientes asignados
                  </div>
                </div>

                {/* Card 4: Compromisos / Recuperación */}
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Compromisos Pactados</div>
                  <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                    ${agentTotalAgreed.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    {promisesCount} promesas registradas
                  </div>
                </div>
              </div>

              {/* Sub-Navigation Tabs inside Inspector */}
              <div className="px-6 pt-4 border-b border-slate-800 bg-slate-900/40 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspectedTab('auditoria')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 cursor-pointer ${
                    inspectedTab === 'auditoria'
                      ? 'border-blue-500 text-blue-400 bg-slate-900/90'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Auditoría de Gestiones (Horas Exactas)</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-900/60 text-blue-300 font-mono">
                    {agentAuditRecords.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setInspectedTab('actividad')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 cursor-pointer ${
                    inspectedTab === 'actividad'
                      ? 'border-blue-500 text-blue-400 bg-slate-900/90'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Resumen y gestión diaria</span>
                </button>

                <button
                  type="button"
                  onClick={() => setInspectedTab('cartera')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 cursor-pointer ${
                    inspectedTab === 'cartera'
                      ? 'border-blue-500 text-blue-400 bg-slate-900/90'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Cartera Asignada ({inspectedAgentClients.length})</span>
                </button>
              </div>

              {/* Tab Contents */}
              <div className="p-6 flex-1 overflow-y-auto space-y-4">
                {/* ======================================================== */}
                {/* TAB 1: AUDITORÍA CON HORAS EXACTAS (HH:MM:SS) */}
                {/* ======================================================== */}
                {inspectedTab === 'auditoria' && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-64">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Buscar en auditoría..."
                            value={auditSearchTerm}
                            onChange={(e) => setAuditSearchTerm(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl glass-input"
                          />
                        </div>

                        <select
                          value={auditChannelFilter}
                          onChange={(e) => setAuditChannelFilter(e.target.value)}
                          className="px-3 py-1.5 text-xs rounded-xl glass-input bg-slate-900 text-slate-200"
                        >
                          <option value="TODOS">Todos los Canales</option>
                          <option value="Llamada">Llamadas</option>
                          <option value="WhatsApp">WhatsApp</option>
                          <option value="Microsoft Teams">Teams</option>
                          <option value="Email">Email</option>
                          <option value="Visita">Visita</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleExportAuditXLSX(filteredAgentAudit, inspectedAgent.name)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Descargar Excel</span>
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-[460px] rounded-xl border border-slate-800 shadow-inner">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-800 shadow-sm">
                          <tr>
                            <th className="py-3 px-3">Hora Exacta</th>
                            <th className="py-3 px-3">Fecha</th>
                            <th className="py-3 px-3 font-mono">Cód. Cliente</th>
                            <th className="py-3 px-3">Cliente Real</th>
                            <th className="py-3 px-3">Canal</th>
                            <th className="py-3 px-3">Duración</th>
                            <th className="py-3 px-3">Contacto</th>
                            <th className="py-3 px-3">Acuerdo</th>
                            <th className="py-3 px-3 text-right">Monto</th>
                            <th className="py-3 px-3">Observaciones de la Gestión</th>
                            <th className="py-3 px-3 text-center">IA</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-medium">
                          {filteredAgentAudit.length === 0 ? (
                            <tr>
                              <td colSpan={11} className="py-8 text-center text-slate-500">
                                No se han registrado gestiones para este agente en el período seleccionado.
                              </td>
                            </tr>
                          ) : (
                            filteredAgentAudit.map((r, idx) => (
                              <tr key={r.id || idx} className="hover:bg-slate-800/40 transition-colors">
                                <td className="py-2.5 px-3 whitespace-nowrap font-mono font-bold text-blue-400 flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                  <span>{r.time}</span>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap text-slate-300 font-mono text-[11px]">
                                  {r.date}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-blue-300 whitespace-nowrap">
                                  {r.clientCode}
                                </td>
                                <td className="py-2.5 px-3 text-slate-200 font-semibold truncate max-w-xs">
                                  {r.clientName}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                                    {r.channel}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-400">
                                  {r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` : 'N/A'}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                    (r.contactSuccess || '').toLowerCase().includes('sí') || (r.contactSuccess || '').toLowerCase().includes('si')
                                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                                      : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                                  }`}>
                                    {r.contactSuccess}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/70 text-blue-300 border border-blue-800">
                                    {r.agreement}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                                  {r.committedAmount ? `$${Number(r.committedAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-300 text-xs truncate max-w-sm" title={r.observations}>
                                  {r.observations}
                                </td>
                                <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800">
                                    {r.aiScore == null ? 'No registrado' : `✓ ${r.aiScore}%`}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ======================================================== */}
                {/* TAB 2: MISMO RESUMEN Y GESTIÓN DIARIA DEL AGENTE, EN SOLO LECTURA */}
                {/* ======================================================== */}
                {inspectedTab === 'actividad' && (
                  <AgentDashboard
                    currentCountry={inspectedAgent.country}
                    agent={inspectedAgent}
                    clients={inspectedAgentClients}
                    onOpenGestionModal={() => undefined}
                    selectedRangeFilter="TODOS"
                    onSelectRange={() => undefined}
                    clientsPerDay={currentQuota}
                    auditLog={agentAuditRecords}
                    readOnly
                  />
                )}

                {/* ======================================================== */}
                {/* TAB 3: CARTERA ASIGNADA */}
                {/* ======================================================== */}
                {inspectedTab === 'cartera' && (
                  <div className="space-y-4">
                    {/* Action Banner for Portfolio Upload / Assignment */}
                    <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/60 border border-blue-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">
                            Asignación de Cartera: {inspectedAgent.name}
                          </span>
                          {inspectedAgentClients.some((c) => c.isManualAssignment) ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                              ✓ Cartera Manual Activa ({inspectedAgentClients.length} clientes)
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-800/60">
                              Reparto Automático
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Sube un Excel o PDF para definir exactamente qué clientes le tocan a este agente. Solo se incluyen clientes activos.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setUploadTargetAgent(inspectedAgent);
                            setIsUploadModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/30 transition-all cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Subir Cartera (Excel/PDF)</span>
                        </button>

                        {inspectedAgentClients.some((c) => c.isManualAssignment) && onClearAgentManualAssignment && (
                          <button
                            type="button"
                            onClick={() => onClearAgentManualAssignment(inspectedAgent.id)}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-all cursor-pointer"
                            title="Volver al reparto automático equitativo"
                          >
                            Restablecer Reparto
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Clientes en Cartera ({inspectedAgentClients.length})
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

                    <div className="overflow-x-auto overflow-y-auto max-h-[460px] rounded-xl border border-slate-800 shadow-inner">
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
                                {c.debtVerified === false ? 'Pendiente SAN' : `$${c.totalDebt.toLocaleString('en-US')}`}
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
                )}
              </div>

              <div className="shrink-0 border-t border-slate-800 bg-slate-950/60 px-5 py-4">
                {agentActionError && (
                  <div role="alert" className="mb-3 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                    {agentActionError}
                  </div>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[11px] text-slate-400">
                    Estado del usuario:{' '}
                    <span className={inspectedAgent.status === 'activo' ? 'font-bold text-emerald-300' : 'font-bold text-amber-300'}>
                      {inspectedAgent.status === 'activo' ? 'Activo' : 'Inactivo'}
                    </span>
                    <span className="ml-2">Desactivar conserva cartera e historial; no redistribuye clientes.</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isAgentActionBusy || !onUpdateAgent}
                      onClick={() => {
                        setAgentActionError('');
                        setIsAgentProfileEditorOpen(true);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-blue-700/70 bg-blue-950/40 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-900/60 disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar usuario
                    </button>
                    <button
                      type="button"
                      disabled={isAgentActionBusy || !onSetAgentStatus}
                      onClick={() => void handleToggleInspectedAgent()}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                        inspectedAgent.status === 'activo'
                          ? 'border-amber-700/70 bg-amber-950/30 text-amber-200 hover:bg-amber-900/50'
                          : 'border-emerald-700/70 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/50'
                      }`}
                    >
                      {inspectedAgent.status === 'activo' ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      {inspectedAgent.status === 'activo' ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      disabled={isAgentActionBusy || !onDeleteAgent}
                      onClick={() => void handleDeleteInspectedAgent()}
                      className="flex items-center gap-1.5 rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar usuario
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {isAgentProfileEditorOpen && inspectedAgent && (
        <AgentProfileEditor
          agent={inspectedAgent}
          onClose={() => setIsAgentProfileEditorOpen(false)}
          onSave={handleSaveInspectedAgent}
        />
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

      {/* Modal Subir y Asignar Cartera Manual */}
      <PortfolioUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setUploadTargetAgent(null);
        }}
        targetAgent={uploadTargetAgent}
        agents={agents}
        currentCountry={currentCountry}
        sapClients={clients}
        onConfirmAssignment={(agentId, assignedClients, replace) => {
          if (onAssignPortfolioToAgent) {
            onAssignPortfolioToAgent(agentId, assignedClients, replace);
          }
          setIsUploadModalOpen(false);
          setUploadTargetAgent(null);
        }}
      />
    </div>
  );
};
