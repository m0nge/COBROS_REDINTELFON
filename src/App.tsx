import React, { useState, useEffect, useRef } from 'react';
import { Agent, AuthUser, Client, Country, CriticalClient, DynamicField, MessageScript, MoraRange, GestionAuditRecord, isClientAssignedToAgent } from './types';
import { INITIAL_DYNAMIC_FIELDS, INITIAL_MESSAGE_SCRIPTS } from './data/mockData';
import { calculateMoraRange } from './utils/moraLogic';
import { fetchCarteraClients } from './services/sapService';
import { Navbar } from './components/Navbar';
import { LoginScreen } from './components/LoginScreen';
import { MoraMotorHeader } from './components/MoraMotorHeader';
import { AgentDashboard } from './components/AgentDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { GestionModal } from './components/GestionModal';
import { SyncStatusModal } from './components/SyncStatusModal';
import { AgentManagementModal } from './components/AgentManagementModal';
import { AcuerdosView } from './components/AcuerdosView';
import { NoContactadosView } from './components/NoContactadosView';
import { ReportesView } from './components/ReportesView';
import { MotorMoraView } from './components/MotorMoraView';
import { ConfiguracionView } from './components/ConfiguracionView';
import { ScriptsLibraryPanel } from './components/ScriptsLibraryPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HardRefreshButton } from './components/HardRefreshButton';
import { CloudUpload, Loader2 } from 'lucide-react';
import { getElSalvadorDateKey, mergeManagementRecords } from './utils/gestionDates';
import { authenticatedApiFetch, loginWithPassword, restoreAppUser, signOutAppUser } from './services/authService';
import { supabase } from './supabaseClient';

const CLIENT_WORKFLOW_STORAGE_KEY = 'red_client_workflow_overrides';
const AUDIT_STORAGE_KEY = 'red_gestiones_auditoria';

function readAuditLogForCountry(country: Country): GestionAuditRecord[] {
  try {
    const scopedKey = `${AUDIT_STORAGE_KEY}:${country}`;
    const scoped = localStorage.getItem(scopedKey);
    if (scoped) {
      const parsed = JSON.parse(scoped);
      return Array.isArray(parsed)
        ? parsed.filter((record) => record?.country === country)
        : [];
    }
    const legacy = localStorage.getItem(AUDIT_STORAGE_KEY);
    const parsed = legacy ? JSON.parse(legacy) : [];
    const scopedRecords = Array.isArray(parsed)
      ? parsed.filter((record) => record?.country === country)
      : [];
    localStorage.setItem(scopedKey, JSON.stringify(scopedRecords));
    return scopedRecords;
  } catch {
    return [];
  }
}

function writeAuditLogForCountry(country: Country, records: GestionAuditRecord[]) {
  try {
    const scopedRecords = records.filter((record) => record.country === country);
    localStorage.setItem(`${AUDIT_STORAGE_KEY}:${country}`, JSON.stringify(scopedRecords));
  } catch (error) {
    console.warn('Storage audit error:', error);
  }
}

function readClientWorkflowOverrides(country: Country): Record<string, Partial<Client>> {
  try {
    const scopedKey = `${CLIENT_WORKFLOW_STORAGE_KEY}:${country}`;
    const scoped = localStorage.getItem(scopedKey);
    const parsed = scoped
      ? JSON.parse(scoped)
      : JSON.parse(localStorage.getItem(CLIENT_WORKFLOW_STORAGE_KEY) || '{}');
    const filtered = Object.fromEntries(
      Object.entries(parsed || {}).filter(([key]) => key.startsWith(`${country}:`)),
    ) as Record<string, Partial<Client>>;
    if (!scoped) localStorage.setItem(scopedKey, JSON.stringify(filtered));
    return filtered;
  } catch {
    return {};
  }
}

function saveClientWorkflowOverride(country: Country, code: string, updates: Partial<Client>) {
  try {
    const storageKey = `${CLIENT_WORKFLOW_STORAGE_KEY}:${country}`;
    const current = JSON.parse(localStorage.getItem(storageKey) || '{}');
    const key = `${country}:${code}`;
    current[key] = { ...(current[key] || {}), ...updates };
    localStorage.setItem(storageKey, JSON.stringify(current));
  } catch (error) {
    console.warn('No se pudo guardar el estado local del cliente:', error);
  }
}

export default function App() {
  // Authentication state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const currentCountry: Country = currentUser?.country || 'SV';
  const [viewMode, setViewMode] = useState<'agente' | 'admin'>('agente');
  const [activeModule, setActiveModule] = useState<string>('inicio');
  const [isLightMode, setIsLightMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('red_cobranza_theme') === 'light';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = isLightMode ? 'light' : 'dark';
    try {
      localStorage.setItem('red_cobranza_theme', isLightMode ? 'light' : 'dark');
    } catch {
      // The theme still applies for the current session if storage is unavailable.
    }
  }, [isLightMode]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentRosterNotice, setAgentRosterNotice] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>(INITIAL_DYNAMIC_FIELDS);

  // Shared operational rule: every agent has a fixed batch of 40 daily leads.
  // Do not read a per-browser quota; it caused agents to see different agendas.
  const clientsPerDay = 40;

  // Message scripts customizable library
  const [messageScripts, setMessageScripts] = useState<MessageScript[]>(INITIAL_MESSAGE_SCRIPTS);

  // Global Audit Log of all gestiones with exact time and metadata
  const [auditLog, setAuditLog] = useState<GestionAuditRecord[]>([]);
  const portfolioRequestId = useRef(0);

  // Sync state
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<string>(new Date().toISOString());
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState<boolean>(false);

  // Filters & Modal States
  const [selectedRangeFilter, setSelectedRangeFilter] = useState<MoraRange | 'TODOS'>('TODOS');
  const [isMotorMoraVisible, setIsMotorMoraVisible] = useState<boolean>(true);
  const [selectedClientForGestion, setSelectedClientForGestion] = useState<Client | null>(null);
  const [isLoadingClients, setIsLoadingClients] = useState<boolean>(true);
  const [isRefreshingPortfolio, setIsRefreshingPortfolio] = useState<boolean>(false);
  const [isSyncingLocalAudit, setIsSyncingLocalAudit] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setAuditLog([]);
      setClients([]);
      setAgents([]);
      setAgentRosterNotice(null);
      setSelectedClientForGestion(null);
      return;
    }
    setAuditLog(readAuditLogForCountry(currentUser.country));
  }, [currentUser]);

  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        const user = await restoreAppUser();
        if (mounted) setCurrentUser(user);
      } catch (error) {
        console.warn('No se pudo restaurar la sesión de Supabase Auth:', error);
      } finally {
        if (mounted) setIsAuthReady(true);
      }
    };
    void restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setIsAuthReady(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load clients using 3-tier resilient SAP service
  const loadCarteraData = async (
    country: Country,
    options: { preserveExisting?: boolean } = {},
  ): Promise<boolean> => {
    const preserveExisting = Boolean(options.preserveExisting);
    const requestId = ++portfolioRequestId.current;
    if (!preserveExisting) {
      setClients([]);
      setAgents([]);
      setAgentRosterNotice(null);
    }
    if (!preserveExisting) setIsLoadingClients(true);
    try {
      let rosterAgents: Agent[] = [];
      const fixedAssignmentByClient = new Map<string, string[]>();
      let assignmentsLoaded = false;
      // The fixed Supabase map is the source of truth. Never invent owners by
      // distributing clients when the map is empty or temporarily unavailable.
      try {
        const agentResponse = await authenticatedApiFetch('/api/agentes');
        if (requestId !== portfolioRequestId.current) return false;

        const notices: string[] = [];
        const agentPayload = await agentResponse.json().catch(() => null);
        if (!agentResponse.ok || !agentPayload?.success || !Array.isArray(agentPayload.agents)) {
          notices.push(agentPayload?.message || 'No se pudo cargar el equipo autenticado desde Supabase.');
          console.error('No se pudo cargar el equipo desde Supabase:', agentPayload?.error || agentResponse.status);
        } else {
          const databaseAgents: Agent[] = agentPayload.agents
            .filter((row: any) =>
              String(row.role || '').trim().toLocaleLowerCase() === 'agente'
              && String(row.country || '').trim().toUpperCase() === country
            )
            .map((row: any) => {
            const previous = agents.find((candidate) => candidate.id === row.id);
            return {
              id: row.id,
                authId: row.authId || null,
                name: row.name,
                email: row.email || previous?.email || '',
                phone: row.phone || '',
                pbxExtension: row.pbxExtension || '',
                country: String(row.country).trim().toUpperCase() as Country,
                role: row.role,
                status: row.status,
                avatarUrl: row.avatarUrl || '',
                effectivenessRate: row.effectivenessRate == null ? null : Number(row.effectivenessRate),
              assignedCount: previous?.assignedCount || 0,
              managedCount: previous?.managedCount || 0,
              pendingCount: previous?.pendingCount || 0,
            };
          });
          rosterAgents = databaseAgents;
          setAgents(rosterAgents);
        }

        if (Array.isArray(agentPayload?.fixedAssignments)) {
          assignmentsLoaded = true;
          const knownAgentIds = new Set(rosterAgents.map((agent) => agent.id));
          let unmatchedAgentIds = 0;
          for (const row of agentPayload.fixedAssignments) {
            if (String(row.pais || '').trim().toUpperCase() !== country) continue;
            const assignmentAgentId = String(row.agente_id || '');
            const assignmentKey = `${String(row.pais).trim().toUpperCase()}:${String(row.codigo_cliente).trim().toUpperCase()}`;
            const ownerIds = fixedAssignmentByClient.get(assignmentKey) || [];
            if (assignmentAgentId && !ownerIds.includes(assignmentAgentId)) {
              ownerIds.push(assignmentAgentId);
              fixedAssignmentByClient.set(assignmentKey, ownerIds);
            }
            if (!knownAgentIds.has(assignmentAgentId)) unmatchedAgentIds += 1;
          }
          if (currentUser?.role === 'admin' && (
            unmatchedAgentIds > 0
            || rosterAgents.length < 2
            || agentPayload.fixedAssignments.length === 0
          )) {
            notices.push('Falta agregar al Ejecutivo 2.');
          }
        } else {
          notices.push('El servidor no devolvió las asignaciones fijas de cartera.');
        }
        setAgentRosterNotice(notices.length ? [...new Set(notices)].join(' ') : null);
      } catch (error) {
        rosterAgents = [];
        if (!preserveExisting) {
          setAgents([]);
          setAgentRosterNotice('No se pudo conectar con Supabase para cargar agentes y asignaciones; no se mostrarán perfiles de prueba ni se repartirán clientes automáticamente.');
        }
        console.error('No se pudo cargar el equipo y la cartera fija desde Supabase:', error);
      }

      if (!assignmentsLoaded) return false;

      const result = await fetchCarteraClients(country);
      if (requestId !== portfolioRequestId.current) return false;
      if (result.timestamp) setLastSyncTimestamp(result.timestamp);

      // Filter out any inactive clients as strictly requested by user:
      // "los cliente inactivos no los ncluyas eso esta en estatus, solo los activos deben salir en este sistema"
      const activeClients = result.clients.filter((c) => {
        const s = String(c.estatus || c.status || '').toUpperCase();
        return !s.includes('INACT') && !s.includes('BAJA') && !s.includes('CANCEL') && !s.includes('SUSPEND') && s !== 'NO ACTIVO';
      });

      // Apply only the spreadsheet-backed owner from Supabase.
      const clientsWithAssignments = activeClients.map((c) => {
        const upperCode = c.code.toUpperCase();
        const fixedAgentIds = fixedAssignmentByClient.get(`${c.country}:${upperCode}`);
        if (fixedAgentIds?.length) {
          const fixedAgent = rosterAgents.find((agent) => agent.id === fixedAgentIds[0]);
          const fixedAgentNames = fixedAgentIds
            .map((agentId) => rosterAgents.find((agent) => agent.id === agentId)?.name)
            .filter(Boolean);
          return {
            ...c,
            assignedAgentId: fixedAgentIds[0],
            assignedAgentIds: fixedAgentIds,
            assignedAgentName: fixedAgentNames.join(' / ') || (fixedAgentIds.length > 1 ? 'Cartera compartida' : fixedAgent?.name || 'Agente'),
            isManualAssignment: true,
            isFixedAssignment: true,
            isSharedAssignment: fixedAgentIds.length > 1,
          };
        }
        return c;
      });

      // Fixed assignments are authoritative; do not redistribute unmapped SAP clients.
      const workflowOverrides = readClientWorkflowOverrides(country);
      const clientsWithWorkflow = clientsWithAssignments.map((client) => {
        const override = workflowOverrides[`${client.country}:${client.code}`] || {};
        const latestSharedManagement = client.sharedManagementHistory?.[0];
        const sharedHistoryItems = (client.sharedManagementHistory || []).map((entry) => {
          const timestamp = new Date(entry.at);
          return {
            id: `shared-${entry.id}`,
            agentId: entry.agentId,
            date: Number.isNaN(timestamp.getTime()) ? '' : getElSalvadorDateKey(timestamp),
            scheduledForDate: entry.scheduledForDate,
            time: Number.isNaN(timestamp.getTime())
              ? ''
              : timestamp.toLocaleTimeString('es-SV', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'America/El_Salvador',
              }),
            channel: entry.channel || 'Llamada',
            contactSuccess: entry.contactSuccess || 'Sí',
            agreement: entry.agreement || 'Sin Acuerdo',
            committedAmount: entry.committedAmount,
            deadlineDate: entry.deadlineDate,
            promiseTime: entry.promiseTime,
            contactName: entry.contactName,
            contactPhone: entry.contactPhone,
            contactEmail: entry.contactEmail,
            observations: entry.observations || 'Gestión compartida sincronizada desde Supabase.',
            agentName: entry.agentId === currentUser?.id ? 'Gestión compartida · tú' : 'Gestión compartida',
            aiVerdict: 'Válida' as const,
            dynamicValues: entry.dynamicValues,
            status: entry.state,
          };
        });
        const localHistory = Array.isArray(override.managementHistory)
          ? override.managementHistory
          : client.managementHistory || [];
        const historyById = new Map<string, typeof sharedHistoryItems[number] | typeof localHistory[number]>();
        [...sharedHistoryItems, ...localHistory].forEach((item) => historyById.set(item.id, item));
        return {
          ...client,
          ...override,
          managementHistory: Array.from(historyById.values()),
          assignedAgentId: client.assignedAgentId,
          assignedAgentIds: client.assignedAgentIds,
          assignedAgentName: client.assignedAgentName,
          isFixedAssignment: client.isFixedAssignment,
          isSharedAssignment: client.isSharedAssignment,
          ...(client.isSharedAssignment ? {
            sharedManagementHistory: client.sharedManagementHistory || [],
            ...(latestSharedManagement ? {
              state: latestSharedManagement.state || client.state,
              lastManagementDate: latestSharedManagement.at,
              lastManagementType: latestSharedManagement.channel,
            } : {}),
          } : {}),
        };
      });
      setClients(clientsWithWorkflow);

      // Counts reflect this SAP portfolio; effectiveness remains the stored value only.
      setAgents(
        rosterAgents.map((ag) => {
          if (ag.country !== country || ag.role !== 'agente') return ag;
          const assigned = clientsWithWorkflow.filter((c) => isClientAssignedToAgent(c, ag.id));
          const count = assigned.length;
          const managed = assigned.filter((c) => c.state === 'Resuelto').length;
          return {
            ...ag,
            assignedCount: count,
            managedCount: managed,
            pendingCount: Math.max(0, count - managed),
          };
        })
      );
      return true;
    } catch (err) {
      if (requestId !== portfolioRequestId.current) return false;
      if (!preserveExisting) {
        setClients([]);
        setAgents([]);
      }
      console.error('Failed to load SAP portfolio:', err);
      return false;
    } finally {
      if (requestId === portfolioRequestId.current) setIsLoadingClients(false);
    }
  };

  useEffect(() => {
    if (!isAuthReady || !currentUser) {
      portfolioRequestId.current += 1;
      setIsLoadingClients(false);
      setClients([]);
      setAgents([]);
      return;
    }
    void loadCarteraData(currentUser.country);
  }, [currentCountry, currentUser, isAuthReady]);

  const loadDynamicFieldsConfig = async () => {
    try {
      const { data, error } = await import('./supabaseClient').then(({ supabase }) =>
        supabase.from('campos_formulario_dinamico').select('*').eq('activo', true).order('orden', { ascending: true })
      );

      if (!error && Array.isArray(data) && data.length > 0) {
        const mapped = data
          .map((item: any) => ({
            id: item.id || `f-${item.orden || Date.now()}`,
            name: item.nombre_campo || item.name || `campo_${item.orden}`,
            label: item.etiqueta || item.label || item.nombre_campo || 'Campo',
            type: (item.tipo_campo || item.type || 'text') as DynamicField['type'],
            options: Array.isArray(item.opciones) ? item.opciones : item.options || [],
            isRequired: Boolean(item.es_obligatorio ?? item.isRequired),
            order: Number(item.orden ?? item.order ?? 1),
            isActive: item.activo ?? item.isActive ?? true,
          }))
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        setDynamicFields(mapped);
        return;
      }

      const response = await fetch('/api/configuracion/campos');
      const result = await response.json();
      if (result?.success && Array.isArray(result.fields)) {
        setDynamicFields(result.fields);
      }
    } catch (err) {
      console.warn('Could not load dynamic fields config:', err);
    }
  };

  useEffect(() => {
    loadDynamicFieldsConfig();
  }, []);

  // Set viewMode and lock country based on logged-in user role
  useEffect(() => {
    if (currentUser) {
      setViewMode(currentUser.role === 'admin' ? 'admin' : 'agente');
    }
  }, [currentUser]);

  const handleLogin = async (email: string, password: string) => {
    const user = await loginWithPassword(email, password);
    setClients([]);
    setAgents([]);
    setAuditLog([]);
    setCurrentUser(user);
    setViewMode(user.role === 'admin' ? 'admin' : 'agente');
    showToast(`✓ Sesión iniciada como ${user.name} (${user.role === 'admin' ? 'Administrador' : 'Agente'}).`);
  };

  const handleLogout = async () => {
    portfolioRequestId.current += 1;
    setClients([]);
    setAgents([]);
    setAuditLog([]);
    setSelectedClientForGestion(null);
    await signOutAppUser();
    setCurrentUser(null);
  };

  // Trigger real manual sync with SAP API
  const handleTriggerSync = async () => {
    try {
      const res = await authenticatedApiFetch('/api/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setLastSyncTimestamp(data.lastSync);
          await loadCarteraData(currentCountry);
          showToast(`✓ Sincronización exitosa con SAP: ${data.counts.sv} clientes SV, ${data.counts.gt} clientes GT.`);
          return;
        }
      }
    } catch (err: any) {
      console.warn('Backend sync route unavailable, refreshing directly from SAP...');
    }

    // Direct refresh fallback
    await loadCarteraData(currentCountry);
    setLastSyncTimestamp(new Date().toISOString());
    showToast(`✓ Cartera actualizada exitosamente con SAP.`);
  };

  // Count clients by mora range for the header
  const countsByRange: Record<MoraRange, number> = {
    '0-30': clients.filter((c) => c.country === currentCountry && c.debtVerified !== false && c.moraRange === '0-30').length,
    '31-60': clients.filter((c) => c.country === currentCountry && c.debtVerified !== false && c.moraRange === '31-60').length,
    '61-90': clients.filter((c) => c.country === currentCountry && c.debtVerified !== false && c.moraRange === '61-90').length,
    '91-120': clients.filter((c) => c.country === currentCountry && c.debtVerified !== false && c.moraRange === '91-120').length,
    '120+': clients.filter((c) => c.country === currentCountry && c.debtVerified !== false && c.moraRange === '120+').length,
  };

  // Add agent (e.g. adding a new agent for Guatemala or another for El Salvador)
  const handleAddAgent = (newAgentData: Omit<Agent, 'id' | 'assignedCount' | 'managedCount' | 'pendingCount' | 'effectivenessRate'>) => {
    if (clients.some((client) => client.isFixedAssignment)) {
      showToast('El equipo y la cartera fija se administran en Supabase; no se creó un agente temporal ni se redistribuyeron clientes.');
      return;
    }
    const newAgent: Agent = {
      ...newAgentData,
      id: `ag-${Date.now()}`,
      effectivenessRate: null,
      assignedCount: 0,
      managedCount: 0,
      pendingCount: 0,
    };
    const updated = [...agents, newAgent];
    setAgents(updated);

    showToast(`✓ Agente ${newAgent.name} agregado para ${newAgent.country === 'SV' ? 'El Salvador' : 'Guatemala'} (PBX: ${newAgent.pbxExtension}).`);
  };

  const handleUpdateAgent = async (
    agentId: string,
    updates: { name: string; email: string; phone: string; country: Country; pbxExtension: string; password: string },
  ): Promise<Agent> => {
    const response = await authenticatedApiFetch('/api/admin/agentes', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'update', id: agentId, ...updates }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success || !result.agent) {
      throw new Error(result?.message || 'No se pudieron guardar los datos del agente.');
    }
    const savedAgent = result.agent as Agent;
    setAgents((previous) => previous.map((agent) => agent.id === agentId ? savedAgent : agent));
    setClients((previous) => previous.map((client) =>
      isClientAssignedToAgent(client, agentId) ? {
        ...client,
        assignedAgentName: client.isSharedAssignment
          ? (client.assignedAgentIds || []).map((id) => id === agentId ? savedAgent.name : agents.find((agent) => agent.id === id)?.name)
            .filter(Boolean)
            .join(' / ')
          : savedAgent.name,
      } : client
    ));
    showToast('Cambios del agente guardados.');
    return savedAgent;
  };

  const handleSetAgentStatus = async (agentId: string, status: 'activo' | 'inactivo'): Promise<Agent> => {
    const response = await authenticatedApiFetch('/api/admin/agentes', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'status', id: agentId, status }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success || !result.agent) {
      throw new Error(result?.message || 'No se pudo cambiar el estado del agente.');
    }
    const savedAgent = result.agent as Agent;
    setAgents((previous) => previous.map((agent) => agent.id === agentId ? savedAgent : agent));
    showToast(status === 'activo' ? 'Agente activado; conserva su asignación fija.' : 'Agente desactivado; su asignación fija se conserva sin reparto automático.');
    return savedAgent;
  };

  const handleDeleteAgent = async (agentId: string) => {
    const response = await authenticatedApiFetch('/api/admin/agentes', {
      method: 'DELETE',
      body: JSON.stringify({ id: agentId }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      throw new Error(result?.message || 'No se pudo eliminar el agente.');
    }
    setAgents((previous) => previous.filter((agent) => agent.id !== agentId));
    showToast(result.authAccountDeleted === false
      ? 'Perfil eliminado; revisa Supabase Auth para limpiar la cuenta sin perfil.'
      : 'Usuario eliminado. El historial se conserva.');
  };

  // Manual portfolio upload & assignment handler per individual agent
  const handleAssignPortfolioToAgent = async (agentId: string, assignedUploadedClients: Client[], replace: boolean) => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent || targetAgent.country !== currentCountry) {
      showToast('No se puede asignar una cartera de otro país.');
      return;
    }
    if (assignedUploadedClients.some((client) => client.country !== currentCountry)) {
      showToast('La cartera importada debe pertenecer al país de esta cuenta.');
      return;
    }

    // Filter only active clients
    const activeUploaded = assignedUploadedClients.filter((c) => {
      const s = String(c.estatus || c.status || '').toUpperCase();
      return !s.includes('INACT') && !s.includes('BAJA') && !s.includes('CANCEL');
    });

    if (clients.some((client) => client.isFixedAssignment && isClientAssignedToAgent(client, agentId))) {
      showToast('Este ejecutivo tiene cartera fija del sheet; no se puede reemplazar ni borrar desde la asignación manual.');
      return;
    }

    const newCodes = activeUploaded.map((c) => c.code.toUpperCase());

    // Update localStorage manual assignments
    let storedAssignments: Record<string, string[]> = {};
    const assignmentStorageKey = `red_manual_assignments:${currentCountry}`;
    try {
      const raw = localStorage.getItem(assignmentStorageKey);
      if (raw) storedAssignments = JSON.parse(raw);
    } catch {}

    if (replace || !storedAssignments[agentId]) {
      storedAssignments[agentId] = newCodes;
    } else {
      storedAssignments[agentId] = Array.from(new Set([...(storedAssignments[agentId] || []), ...newCodes]));
    }
    localStorage.setItem(assignmentStorageKey, JSON.stringify(storedAssignments));

    // Update clients state
    setClients((prev) => {
      // If replace, clear assignment on clients previously belonging to this agent that are not in the new list
      let updated = prev.map((c) => {
        const upperCode = c.code.toUpperCase();
        if (newCodes.includes(upperCode)) {
          return {
            ...c,
            assignedAgentId: agentId,
            assignedAgentIds: [agentId],
            assignedAgentName: targetAgent.name,
            isManualAssignment: true,
            isSharedAssignment: false,
          };
        }
        if (replace && isClientAssignedToAgent(c, agentId) && !newCodes.includes(upperCode)) {
          return {
            ...c,
            assignedAgentId: undefined,
            assignedAgentIds: undefined,
            assignedAgentName: undefined,
            isManualAssignment: false,
          };
        }
        return c;
      });

      // If any uploaded client was not in the existing list, append them
      const existingCodes = new Set(updated.map((c) => c.code.toUpperCase()));
      const missingClients = activeUploaded
        .filter((c) => !existingCodes.has(c.code.toUpperCase()))
        .map((c) => ({
          ...c,
          assignedAgentId: agentId,
          assignedAgentIds: [agentId],
          assignedAgentName: targetAgent.name,
          isManualAssignment: true,
          isSharedAssignment: false,
        }));

      updated = [...updated, ...missingClients];

      // Update agent stats
      const assignedCount = updated.filter((c) => c.country === targetAgent.country && isClientAssignedToAgent(c, agentId)).length;
      const managedCount = updated.filter((c) => c.country === targetAgent.country && isClientAssignedToAgent(c, agentId) && c.state === 'Resuelto').length;

      setAgents((prevAgents) =>
        prevAgents.map((ag) =>
          ag.id === agentId
            ? {
                ...ag,
                assignedCount,
                managedCount,
                pendingCount: Math.max(0, assignedCount - managedCount),
              }
            : ag
        )
      );

      return updated;
    });

    showToast(
      `✓ Cartera de ${activeUploaded.length} clientes asignada exitosamente a ${targetAgent.name}. Solo clientes activos incluidos.`
    );
  };

  // Clear manual assignment and restore automatic equal distribution
  const handleClearAgentManualAssignment = async (agentId: string) => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent || targetAgent.country !== currentCountry) {
      showToast('No se puede cambiar una cartera de otro país.');
      return;
    }
    if (clients.some((client) => client.isFixedAssignment && isClientAssignedToAgent(client, agentId))) {
      showToast('Esta cartera proviene del sheet y no se puede restablecer al reparto automático.');
      return;
    }

    let storedAssignments: Record<string, string[]> = {};
    const assignmentStorageKey = `red_manual_assignments:${currentCountry}`;
    try {
      const raw = localStorage.getItem(assignmentStorageKey);
      if (raw) storedAssignments = JSON.parse(raw);
    } catch {}

    delete storedAssignments[agentId];
    localStorage.setItem(assignmentStorageKey, JSON.stringify(storedAssignments));

    setClients((prev) => {
      const unassigned = prev.map((c) =>
        isClientAssignedToAgent(c, agentId)
          ? { ...c, assignedAgentId: undefined, assignedAgentIds: undefined, isManualAssignment: false }
          : c
      );
      setAgents((prevAgents) => prevAgents.map((agent) => {
        if (agent.country !== currentCountry || agent.role !== 'agente') return agent;
        const assigned = unassigned.filter((client) => isClientAssignedToAgent(client, agent.id));
        const managedCount = assigned.filter((client) => client.state === 'Resuelto').length;
        return {
          ...agent,
          assignedCount: assigned.length,
          managedCount,
          pendingCount: Math.max(0, assigned.length - managedCount),
        };
      }));
      return unassigned;
    });

    showToast(`✓ Se restableció el reparto automático para ${targetAgent?.name || 'el agente'}.`);
  };

  // Update dynamic fields configuration
  const handleUpdateDynamicFields = async (updatedFields: DynamicField[]) => {
    const normalized = [...updatedFields]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((field, index) => {
        const validUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(field.id || '');
        return {
          ...field,
          id: validUuid ? field.id : crypto.randomUUID(),
          order: index + 1,
          isActive: field.isActive !== false,
        };
      });

    setDynamicFields(normalized);

    try {
      const { supabase } = await import('./supabaseClient');
      const rows = normalized.map((field) => ({
        id: field.id,
        nombre_campo: field.name,
        etiqueta: field.label,
        tipo_campo: field.type,
        opciones: Array.isArray(field.options) ? field.options : [],
        es_obligatorio: Boolean(field.isRequired),
        orden: field.order,
        activo: field.isActive !== false,
      }));

      const { error } = await supabase.from('campos_formulario_dinamico').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    } catch (err) {
      console.warn('Supabase fields persistence failed, using API fallback:', err);
      await fetch('/api/configuracion/campos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: normalized }),
      }).catch(console.error);
    }

    showToast('✓ Formulario dinámico de bitácora actualizado con éxito.');
  };

  // Save successful gestion
  const handleSaveGestionSuccess = (
    clientCode: string,
    updatedProps: Partial<Client>,
    auditRecord?: GestionAuditRecord
  ) => {
    const targetClient = clients.find((client) => client.code === clientCode && client.country === currentCountry);
    if (targetClient) saveClientWorkflowOverride(targetClient.country, clientCode, updatedProps);

    if (auditRecord) {
      setAuditLog((prev) => {
        const next = [auditRecord, ...prev.filter((a) => a.id !== auditRecord.id)]
          .filter((record) => record.country === currentCountry);
        writeAuditLogForCountry(currentCountry, next);
        return next;
      });
    }

    setClients((prev) => {
      const updatedClients = prev.map((c) => (
        c.code === clientCode && c.country === currentCountry ? { ...c, ...updatedProps } : c
      ));
      
      // Keep agents state strictly synchronized with the updated clients
      setAgents((prevAgents) =>
        prevAgents.map((ag) => {
          if (ag.role !== 'agente') return ag;
          const assigned = updatedClients.filter(
            (c) => c.country === ag.country && isClientAssignedToAgent(c, ag.id)
          );
          const count = assigned.length;
          const managed = assigned.filter((c) => c.state === 'Resuelto').length;
          return {
            ...ag,
            assignedCount: count,
            managedCount: managed,
            pendingCount: Math.max(0, count - managed),
          };
        })
      );
      
      return updatedClients;
    });

    setSelectedClientForGestion(null);
    window.dispatchEvent(new Event('red-cobranza:audit-sync-complete'));
    showToast(`✓ Gestión registrada para el cliente ${clientCode}.`);
  };

  // Live synchronization of real 360 data back into the main clients table
  const handleUpdateClientData = (clientCode: string, updates: Partial<Client>) => {
    const existingClient = clients.find((client) => client.code === clientCode && client.country === currentCountry);
    if (existingClient && ('state' in updates || 'scheduledDate' in updates)) {
      saveClientWorkflowOverride(existingClient.country, clientCode, updates);
    }
    setClients((prev) => {
      let hasChanges = false;
      const updated = prev.map((c) => {
        if (c.code !== clientCode || c.country !== currentCountry) return c;
        for (const [k, v] of Object.entries(updates)) {
          if ((c as any)[k] !== v) {
            hasChanges = true;
            return { ...c, ...updates };
          }
        }
        return c;
      });
      return hasChanges ? updated : prev;
    });

    setSelectedClientForGestion((prev) => {
      if (!prev || prev.code !== clientCode || prev.country !== currentCountry) return prev;
      let hasChanges = false;
      for (const [k, v] of Object.entries(updates)) {
        if ((prev as any)[k] !== v) {
          hasChanges = true;
          break;
        }
      }
      return hasChanges ? { ...prev, ...updates } : prev;
    });
  };

  // Escalate critical client
  const handleEscalateClient = (client: CriticalClient) => {
    setClients((prev) =>
      prev.map((c) =>
        c.code === client.clientCode && c.country === currentCountry ? { ...c, state: 'Escalado' as any } : c
      )
    );
    showToast(`⚠️ Cliente crítico ${client.name} (${client.clientCode}) escalado a Cobranza Judicial.`);
  };

  // Reschedule client interaction to a specific day (Days 1 to 22)
  // If target day exceeds clientsPerDay (e.g. 41), displace the lowest-urgency client to the next day up to day 22
  const handleRescheduleClient = (clientCode: string, targetDate: string | number, reason = 'Reprogramado por Agente') => {
    const today = getElSalvadorDateKey();
    const todayParts = today.split('-');
    const validDate = typeof targetDate === 'number'
      ? `${todayParts[0]}-${todayParts[1]}-${String(targetDate).padStart(2, '0')}`
      : targetDate.slice(0, 10);
    const validTarget = Number(validDate.slice(8, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validDate) || !validDate.startsWith(today.slice(0, 7))) {
      showToast('La fecha de reprogramación debe estar dentro del mes actual.');
      return;
    }

    setClients((prev) => {
      const clientIndex = prev.findIndex((c) => c.code === clientCode && c.country === currentCountry);
      if (clientIndex === -1) return prev;

      const targetClient = prev[clientIndex];
      const nextRound = (targetClient.callRound || 1) + 1;
      const roundLabel = `${nextRound}ª Llamada (${reason})`;

      const updated = [...prev];

      // Update rescheduled client
      updated[clientIndex] = {
        ...targetClient,
        scheduledDay: validTarget,
        scheduledDate: validDate,
        callRound: nextRound,
        callRoundLabel: roundLabel,
        state: 'Reprogramado',
      };
      saveClientWorkflowOverride(targetClient.country, clientCode, updated[clientIndex]);

      return updated;
    });

    showToast(`✓ Cliente ${clientCode} reprogramado para el ${validDate}.`);
  };

  const handleScheduleFollowUp = (clientCode: string, targetDate: string, reason = 'Segunda llamada de seguimiento') => {
    const targetClient = clients.find((client) => client.code === clientCode && client.country === currentCountry);
    if (!targetClient) return;
    const now = new Date();
    const auditRecord: GestionAuditRecord = {
      id: `audit-followup-${Date.now()}`,
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      agentId: currentUser?.id || targetClient.assignedAgentId || '',
      agentName: currentUser?.name || targetClient.assignedAgentName || 'Agente',
      clientCode,
      clientName: targetClient.name,
      country: targetClient.country,
      channel: 'Llamada',
      contactSuccess: 'Sin respuesta',
      agreement: 'Sin Acuerdo',
      observations: `Seguimiento programado para ${targetDate}. Motivo: ${reason}.`,
      callRoundLabel: 'Segunda llamada de seguimiento',
      status: 'Reprogramado',
      dynamicValues: { scheduledDate: targetDate, reason },
    };
    setAuditLog((previous) => {
      const next = [auditRecord, ...previous].filter((record) => record.country === currentCountry);
      writeAuditLogForCountry(currentCountry, next);
      return next;
    });
    handleRescheduleClient(clientCode, targetDate, reason);
  };

  const handleNavigateModule = (moduleId: string) => {
    const destination = moduleId === 'scripts-mensajes' && currentUser?.role !== 'admin' ? 'inicio' : moduleId;
    setActiveModule(destination);
    const anchor = document.getElementById(destination);
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const handleRefreshPortfolio = async () => {
    if (!currentUser || isRefreshingPortfolio) return;
    setIsRefreshingPortfolio(true);
    try {
      const refreshed = await loadCarteraData(currentCountry, { preserveExisting: true });
      showToast(refreshed
        ? '✓ Cartera y asignaciones actualizadas.'
        : 'No se pudo actualizar; conservamos la cartera visible. Intenta de nuevo.');
    } finally {
      setIsRefreshingPortfolio(false);
    }
  };

  // If user is not authenticated, render LoginScreen
  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
        <span className="text-sm">Verificando sesión…</span>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Active agent: For agent logged in, match by identity; for admin, first active agent of country
  const matchedAgentForUser = currentUser.role === 'agente'
    ? agents.find(
          (a) =>
            a.id === currentUser.id ||
            a.name.toLowerCase() === currentUser.name.toLowerCase() ||
            a.email.toLowerCase() === currentUser.email.toLowerCase()
        )
    : undefined;
  const activeAgent = currentUser.role === 'agente'
    ? matchedAgentForUser
    : agents.find((a) => a.country === currentCountry && a.role === 'agente');
  const handleSyncLocalAudit = async () => {
    if (!matchedAgentForUser || currentUser.role !== 'agente' || isSyncingLocalAudit) return;
    const matchesAgent = (record: GestionAuditRecord) => (
      record.country === currentCountry
      && (
        record.agentId === matchedAgentForUser.id
        || record.agentName?.trim().toLocaleLowerCase() === matchedAgentForUser.name.trim().toLocaleLowerCase()
        || record.agentEmail?.trim().toLocaleLowerCase() === matchedAgentForUser.email.trim().toLocaleLowerCase()
      )
    );
    const localRecords = auditLog.filter(matchesAgent);
    if (localRecords.length === 0) {
      showToast('No se encontraron gestiones locales de esta agente para sincronizar.');
      return;
    }

    setIsSyncingLocalAudit(true);
    try {
      const batches: GestionAuditRecord[][] = [];
      for (let index = 0; index < localRecords.length; index += 100) {
        batches.push(localRecords.slice(index, index + 100));
      }
      const requestSync = async (mode: 'preview' | 'commit', records: GestionAuditRecord[]) => {
        const response = await authenticatedApiFetch('/api/cartera?action=sync-gestiones', {
          method: 'POST',
          body: JSON.stringify({ pais: currentCountry, mode, source: 'localStorage', records }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || 'No se pudo sincronizar la bitácora local.');
        }
        return payload;
      };

      const previews = [];
      for (const batch of batches) {
        previews.push({ batch, result: await requestSync('preview', batch) });
      }
      const toImport = previews.reduce((sum, item) => sum + Number(item.result.toImportCount || 0), 0);
      const alreadyPresent = previews.reduce((sum, item) => sum + Number(item.result.alreadyPresentCount || 0), 0);
      const skipped = previews.reduce((sum, item) => sum + Number(item.result.skippedCount || 0), 0);
      if (toImport === 0) {
        showToast(`Sin cambios: ${alreadyPresent} ya están en el servidor${skipped ? `; ${skipped} omitidas por validación` : ''}.`);
        return;
      }

      const confirmed = window.confirm(
        `Se encontraron ${localRecords.length} gestiones locales. ${alreadyPresent} ya están en el servidor y se importarán ${toImport} faltantes${skipped ? `; ${skipped} se omitirán por validación o porque son pagos que requieren verificación SAN` : ''}. ¿Confirmas la importación para que queden visibles en auditoría para administración?`,
      );
      if (!confirmed) return;

      let imported = 0;
      for (const item of previews) {
        if (Number(item.result.toImportCount || 0) === 0) continue;
        const result = await requestSync('commit', item.batch);
        imported += Number(result.importedCount || 0);
      }
      showToast(`Sincronización terminada: ${imported} importadas, ${alreadyPresent} ya existentes${skipped ? ` y ${skipped} omitidas` : ''}.`);
      window.dispatchEvent(new Event('red-cobranza:audit-sync-complete'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falló la sincronización de gestiones locales.');
    } finally {
      setIsSyncingLocalAudit(false);
    }
  };
  const countryAuditLog = auditLog.filter((record) => record.country === currentCountry);
  const reportAuditLog = mergeManagementRecords(countryAuditLog, clients);

  return (
    <div data-theme={isLightMode ? 'light' : 'dark'} className="min-h-screen bg-slate-950 text-slate-100 flex antialiased">
      <Navbar
        currentUser={currentUser}
        agentPbxExtension={matchedAgentForUser?.pbxExtension}
        onLogout={handleLogout}
        currentCountry={currentCountry}
        activeModule={activeModule}
        onNavigate={handleNavigateModule}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        onToggleMotorMora={() => setIsMotorMoraVisible(!isMotorMoraVisible)}
        isMotorMoraVisible={isMotorMoraVisible}
        lastSyncTimestamp={lastSyncTimestamp}
        onOpenAgentModal={() => setIsAgentModalOpen(true)}
        agentsCount={agents.length}
        isLightMode={isLightMode}
        onToggleTheme={() => setIsLightMode((current) => !current)}
      />

      <div className="flex-1 min-w-0">
        <main className="max-w-[1700px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {activeModule === 'inicio' && (
            <div className="mb-3 flex justify-end gap-2">
              {currentUser.role === 'agente' && matchedAgentForUser && (
                <button
                  type="button"
                  onClick={() => void handleSyncLocalAudit()}
                  disabled={isSyncingLocalAudit}
                  title="Revisa y sube las gestiones guardadas solo en esta computadora"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-400/30 bg-blue-700 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-600 disabled:cursor-wait disabled:opacity-70"
                >
                  <CloudUpload className={`h-3.5 w-3.5 ${isSyncingLocalAudit ? 'animate-pulse' : ''}`} />
                  <span>{isSyncingLocalAudit ? 'Sincronizando…' : 'Sincronizar gestiones'}</span>
                </button>
              )}
              <HardRefreshButton
                onRefresh={handleRefreshPortfolio}
                isRefreshing={isRefreshingPortfolio}
              />
            </div>
          )}

          {/* Toast feedback banner */}
          {toastMessage && (
            <div className="mb-6 p-4 rounded-xl bg-blue-950/90 border border-blue-500/80 text-blue-200 text-xs font-semibold shadow-xl shadow-blue-900/40 flex items-center justify-between">
              <span>{toastMessage}</span>
              <button
                onClick={() => setToastMessage(null)}
                className="text-blue-400 hover:text-white ml-4 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Slide 1: Motor del Sistema: Clasificación Automática (Visible on general dashboards) */}
          {isMotorMoraVisible && !(currentUser.role === 'admin' && activeModule === 'inicio') && (activeModule === 'inicio' || activeModule === 'mi-cartera' || activeModule === 'lista-gestion') && (
            <MoraMotorHeader
              countsByRange={countsByRange}
              selectedRangeFilter={selectedRangeFilter}
              onSelectRange={setSelectedRangeFilter}
            />
          )}

          {/* Loading state indicator */}
          {isLoadingClients ? (
            <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <span className="text-sm font-medium">
                Cargando cartera real SAP ({currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'})...
              </span>
            </div>
          ) : (
            <>
              {/* Dedicated View: Acuerdos de Pago */}
              {activeModule === 'acuerdos' && (
                <AcuerdosView
                  currentCountry={currentCountry}
                  clients={clients}
                  agents={agents}
                  currentAgent={activeAgent}
                  onOpenGestionModal={setSelectedClientForGestion}
                  isAdmin={currentUser.role === 'admin'}
                  onUpdateClientData={handleUpdateClientData}
                  onScheduleFollowUp={handleScheduleFollowUp}
                />
              )}

              {/* Dedicated View: Clientes No Contactados */}
              {activeModule === 'no-contactados' && (
                <NoContactadosView
                  currentCountry={currentCountry}
                  clients={clients}
                  onOpenGestionModal={setSelectedClientForGestion}
                  isAdmin={currentUser.role === 'admin'}
                />
              )}

              {/* Dedicated View: Reportes e Inteligencia Financiera */}
              {activeModule === 'reportes' && (
                <ReportesView
                  currentCountry={currentCountry}
                  clients={clients}
                  agents={agents}
                  isAdmin={currentUser.role === 'admin'}
                />
              )}

              {/* Dedicated View: Motor de Mora y Priorización */}
              {activeModule === 'motor-mora' && (
                <MotorMoraView
                  currentCountry={currentCountry}
                  clients={clients}
                  onOpenGestionModal={setSelectedClientForGestion}
                  isAdmin={currentUser.role === 'admin'}
                />
              )}

              {/* Dedicated View: Configuración del Sistema (Admin) */}
              {activeModule === 'configuracion' && currentUser.role === 'admin' && (
                <ConfiguracionView
                  currentCountry={currentCountry}
                  onTriggerSync={handleTriggerSync}
                  lastSyncTimestamp={lastSyncTimestamp}
                />
              )}

              {/* Dedicated View: Biblioteca de Scripts de Mensajes */}
              {activeModule === 'scripts-mensajes' && currentUser.role === 'admin' && (
                <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
                  <div className="border-b border-slate-800 pb-4">
                    <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
                      Plantillas Personalizadas & Variables de Cliente · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">
                      Biblioteca de Scripts de Mensajes
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 max-w-3xl">
                      Crea, edita y copia scripts de cobranza usando variables dinámicas ({'{nombre_cliente}'}, {'{monto_total}'}, {'{dias_mora}'}, etc.) con datos reales reemplazados al instante.
                    </p>
                  </div>

                  <ScriptsLibraryPanel
                    scripts={messageScripts}
                    onSaveScripts={setMessageScripts}
                    sampleClient={clients[0]}
                    isAdmin={currentUser.role === 'admin'}
                  />
                </div>
              )}

              {/* Default General Operational Dashboard for Agent */}
              {!['acuerdos', 'no-contactados', 'reportes', 'motor-mora', 'scripts-mensajes', 'configuracion'].includes(activeModule) && currentUser.role === 'agente' && matchedAgentForUser && (
                <AgentDashboard
                  currentCountry={currentCountry}
                  agent={matchedAgentForUser}
                  clients={clients}
                  dynamicFields={dynamicFields}
                  onOpenGestionModal={setSelectedClientForGestion}
                  selectedRangeFilter={selectedRangeFilter}
                  onSelectRange={setSelectedRangeFilter}
                  activeModule={activeModule}
                  clientsPerDay={clientsPerDay}
                  auditLog={reportAuditLog}
                />
              )}
              {!['acuerdos', 'no-contactados', 'reportes', 'motor-mora', 'scripts-mensajes', 'configuracion'].includes(activeModule) && currentUser.role === 'agente' && !matchedAgentForUser && (
                <div className="rounded-2xl border border-amber-700/50 bg-amber-950/30 p-6 text-sm text-amber-200">
                  Esta cuenta no está vinculada a un agente registrado. No se mostrará la cartera de otro usuario.
                </div>
              )}

              {/* Default Executive Administration Dashboard for Admin */}
              {!['acuerdos', 'no-contactados', 'reportes', 'motor-mora', 'scripts-mensajes', 'configuracion'].includes(activeModule) && currentUser.role === 'admin' && (
                <AdminDashboard
                  currentCountry={currentCountry}
                  agents={agents}
                  agentRosterNotice={agentRosterNotice}
                  clients={clients}
                  dynamicFields={dynamicFields}
                  onUpdateDynamicFields={handleUpdateDynamicFields}
                  onAddAgent={handleAddAgent}
                  onUpdateAgent={handleUpdateAgent}
                  onSetAgentStatus={handleSetAgentStatus}
                  onDeleteAgent={handleDeleteAgent}
                  criticalClients={[]}
                  onEscalateClient={handleEscalateClient}
                  messageScripts={messageScripts}
                  onUpdateMessageScripts={setMessageScripts}
                  onAssignPortfolioToAgent={handleAssignPortfolioToAgent}
                  onClearAgentManualAssignment={handleClearAgentManualAssignment}
                  activeModule={activeModule}
                  auditLog={countryAuditLog}
                  onOpenGestionModal={setSelectedClientForGestion}
                />
              )}
            </>
          )}
        </main>

        <footer className="border-t border-slate-900 bg-slate-950 py-5 text-center text-xs text-slate-500">
          <div className="max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>RED El Salvador & Guatemala · Sistema de Cobranzas y Recuperación de Cartera</span>
          </div>
        </footer>
      </div>

      {/* Slide 5 & Slide 6: Cierre de Acuerdos Modal */}
      {selectedClientForGestion && (
        <ErrorBoundary
          fallbackTitle="Error al abrir la gestión del cliente"
          isModal
          onClose={() => setSelectedClientForGestion(null)}
        >
          <GestionModal
            client={selectedClientForGestion}
            currentUser={currentUser}
            activeAgent={currentUser.role === 'agente' ? matchedAgentForUser : undefined}
            onClose={() => setSelectedClientForGestion(null)}
            onSaveGestionSuccess={handleSaveGestionSuccess}
            onUpdateClientData={handleUpdateClientData}
            dynamicFields={dynamicFields}
            scripts={messageScripts}
            onRescheduleClient={handleRescheduleClient}
          />
        </ErrorBoundary>
      )}

      {/* Sincronización en Vivo Modal */}
      {isSyncModalOpen && (
        <SyncStatusModal
          onClose={() => setIsSyncModalOpen(false)}
          onTriggerSync={handleTriggerSync}
          lastSyncTimestamp={lastSyncTimestamp}
        />
      )}

      {/* Gestión de Agentes y Extensiones PBX Modal (Admin) */}
      {isAgentModalOpen && (
        <AgentManagementModal
          isOpen={isAgentModalOpen}
          onClose={() => setIsAgentModalOpen(false)}
          currentCountry={currentCountry}
          agents={agents.filter((agent) => agent.country === currentCountry)}
          onAddAgent={({ name, pbxExtension, phone }) => {
            handleAddAgent({
              name,
              country: currentCountry,
              pbxExtension,
              phone,
              email: `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@red.com.sv`,
              role: 'agente',
              status: 'activo',
              avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
            });
          }}
          onDeleteAgent={handleDeleteAgent}
        />
      )}
    </div>
  );
}
