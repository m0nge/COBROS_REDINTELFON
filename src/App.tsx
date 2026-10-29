import React, { useState, useEffect } from 'react';
import { Agent, AuthUser, Client, Country, CriticalClient, DynamicField, MessageScript, MoraRange, GestionAuditRecord } from './types';
import { INITIAL_AGENTS, INITIAL_DYNAMIC_FIELDS, INITIAL_MESSAGE_SCRIPTS } from './data/mockData';
import { calculateMoraRange, distributeClientsEqually } from './utils/moraLogic';
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
import { Loader2 } from 'lucide-react';
import { getElSalvadorDateKey, mergeManagementRecords } from './utils/gestionDates';

const CLIENT_WORKFLOW_STORAGE_KEY = 'red_client_workflow_overrides';

function saveClientWorkflowOverride(country: Country, code: string, updates: Partial<Client>) {
  try {
    const current = JSON.parse(localStorage.getItem(CLIENT_WORKFLOW_STORAGE_KEY) || '{}');
    const key = `${country}:${code}`;
    current[key] = { ...(current[key] || {}), ...updates };
    localStorage.setItem(CLIENT_WORKFLOW_STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    console.warn('No se pudo guardar el estado local del cliente:', error);
  }
}

export default function App() {
  // Authentication state
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('red_cobranza_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [currentCountry, setCurrentCountry] = useState<Country>('SV');
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
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [clients, setClients] = useState<Client[]>([]);
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>(INITIAL_DYNAMIC_FIELDS);

  // Daily quota capacity (default: 40 clients per day per agent, window 1 to 22)
  const [clientsPerDay, setClientsPerDay] = useState<number>(40);

  // Message scripts customizable library
  const [messageScripts, setMessageScripts] = useState<MessageScript[]>(INITIAL_MESSAGE_SCRIPTS);

  // Global Audit Log of all gestiones with exact time and metadata
  const [auditLog, setAuditLog] = useState<GestionAuditRecord[]>(() => {
    try {
      const raw = localStorage.getItem('red_gestiones_auditoria');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Sync state
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<string>(new Date().toISOString());
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState<boolean>(false);

  // Filters & Modal States
  const [selectedRangeFilter, setSelectedRangeFilter] = useState<MoraRange | 'TODOS'>('TODOS');
  const [isMotorMoraVisible, setIsMotorMoraVisible] = useState<boolean>(true);
  const [selectedClientForGestion, setSelectedClientForGestion] = useState<Client | null>(null);
  const [isLoadingClients, setIsLoadingClients] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Load clients using 3-tier resilient SAP service
  const loadCarteraData = async (country: Country) => {
    setIsLoadingClients(true);
    try {
      const result = await fetchCarteraClients(country);
      if (result.timestamp) setLastSyncTimestamp(result.timestamp);

      // Filter out any inactive clients as strictly requested by user:
      // "los cliente inactivos no los ncluyas eso esta en estatus, solo los activos deben salir en este sistema"
      const activeClients = result.clients.filter((c) => {
        const s = String(c.estatus || c.status || '').toUpperCase();
        return !s.includes('INACT') && !s.includes('BAJA') && !s.includes('CANCEL') && !s.includes('SUSPEND') && s !== 'NO ACTIVO';
      });

      // Retrieve any persisted manual assignments (localStorage / backend)
      let storedAssignments: Record<string, string[]> = {};
      try {
        const raw = localStorage.getItem('red_manual_assignments');
        if (raw) storedAssignments = JSON.parse(raw);
      } catch (e) {
        console.warn('Could not read manual assignments from storage');
      }

      // Apply manual assignments to active clients
      const clientsWithAssignments = activeClients.map((c) => {
        const upperCode = c.code.toUpperCase();
        for (const [agId, codes] of Object.entries(storedAssignments)) {
          if (Array.isArray(codes) && codes.includes(upperCode)) {
            const ag = agents.find((a) => a.id === agId);
            return {
              ...c,
              assignedAgentId: agId,
              assignedAgentName: ag?.name || 'Agente',
              isManualAssignment: true,
            };
          }
        }
        return c;
      });

      // Distribute the remaining unassigned active clients equally among active agents
      let workflowOverrides: Record<string, Partial<Client>> = {};
      try {
        workflowOverrides = JSON.parse(localStorage.getItem(CLIENT_WORKFLOW_STORAGE_KEY) || '{}');
      } catch {
        workflowOverrides = {};
      }
      const clientsWithWorkflow = clientsWithAssignments.map((client) => ({
        ...client,
        ...(workflowOverrides[`${client.country}:${client.code}`] || {}),
      }));
      const distributed = distributeClientsEqually(clientsWithWorkflow, agents);
      setClients(distributed);

      // Synchronize agent counts and real effectiveness rate
      setAgents((prev) =>
        prev.map((ag) => {
          if (ag.country !== country || ag.role !== 'agente') return ag;
          const assigned = distributed.filter((c) => !c.assignedAgentId || c.assignedAgentId === ag.id);
          const count = assigned.length;
          const managed = assigned.filter((c) => c.state === 'Resuelto').length;
          return {
            ...ag,
            assignedCount: count,
            managedCount: managed,
            pendingCount: Math.max(0, count - managed),
            effectivenessRate: count > 0 ? Number(((managed / count) * 100).toFixed(1)) : 0.0,
          };
        })
      );
    } catch (err) {
      console.error('Failed to load SAP portfolio:', err);
    } finally {
      setIsLoadingClients(false);
    }
  };

  useEffect(() => {
    loadCarteraData(currentCountry);
  }, [currentCountry]);

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
      if (currentUser.role === 'admin') {
        setViewMode('admin');
      } else {
        setViewMode('agente');
        // Ensure agent is always on their assigned country
        if (currentUser.country) {
          setCurrentCountry(currentUser.country);
        }
      }
    }
  }, [currentUser]);

  const handleLogin = (user: AuthUser) => {
    setCurrentUser(user);
    localStorage.setItem('red_cobranza_user', JSON.stringify(user));
    if (user.role === 'admin') {
      setViewMode('admin');
    } else {
      setViewMode('agente');
      // For agents (like María), lock to assigned country
      setCurrentCountry(user.country);
    }
    showToast(`✓ Sesión iniciada como ${user.name} (${user.role === 'admin' ? 'Administrador' : 'Agente'}).`);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('red_cobranza_user');
  };

  // Trigger real manual sync with SAP API
  const handleTriggerSync = async () => {
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
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
    '0-30': clients.filter((c) => c.country === currentCountry && c.moraRange === '0-30').length,
    '31-60': clients.filter((c) => c.country === currentCountry && c.moraRange === '31-60').length,
    '61-90': clients.filter((c) => c.country === currentCountry && c.moraRange === '61-90').length,
    '91-120': clients.filter((c) => c.country === currentCountry && c.moraRange === '91-120').length,
    '120+': clients.filter((c) => c.country === currentCountry && c.moraRange === '120+').length,
  };

  // Trigger monthly workload distribution:
  // Divides clients equally among active agents of the country and spreads them Mon-Fri 8am-6pm
  const handleDistributeCartera = () => {
    const redistributed = distributeClientsEqually(clients, agents);
    setClients(redistributed);

    // Update agent assigned counts and real dynamic effectiveness
    setAgents((prev) =>
      prev.map((ag) => {
        if (ag.country !== currentCountry || ag.role !== 'agente') return ag;
        const count = redistributed.filter((c) => c.assignedAgentId === ag.id).length;
        const managed = redistributed.filter((c) => c.assignedAgentId === ag.id && c.state === 'Resuelto').length;
        return {
          ...ag,
          assignedCount: count,
          managedCount: managed,
          pendingCount: Math.max(0, count - managed),
          effectivenessRate: count > 0 ? Number(((managed / count) * 100).toFixed(1)) : 0.0,
        };
      })
    );

    showToast(
      `✓ Cartera de ${currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'} distribuida equitativamente entre los agentes activos.`
    );
  };

  // Add agent (e.g. adding a new agent for Guatemala or another for El Salvador)
  const handleAddAgent = (newAgentData: Omit<Agent, 'id' | 'assignedCount' | 'managedCount' | 'pendingCount' | 'effectivenessRate'>) => {
    const newAgent: Agent = {
      ...newAgentData,
      id: `ag-${Date.now()}`,
      effectivenessRate: 0.0,
      assignedCount: 0,
      managedCount: 0,
      pendingCount: 0,
    };
    const updated = [...agents, newAgent];
    setAgents(updated);

    // Redistribute to include new agent
    const redistributed = distributeClientsEqually(clients, updated);
    setClients(redistributed);
    showToast(`✓ Agente ${newAgent.name} agregado para ${newAgent.country === 'SV' ? 'El Salvador' : 'Guatemala'} (PBX: ${newAgent.pbxExtension}). Cartera recalculada.`);
  };

  // Delete agent and redistribute
  const handleDeleteAgent = (agentId: string) => {
    const updated = agents.filter((ag) => ag.id !== agentId);
    setAgents(updated);
    const redistributed = distributeClientsEqually(clients, updated);
    setClients(redistributed);
    showToast('✓ Agente retirado y cartera redistribuida entre agentes activos.');
  };

  // Manual portfolio upload & assignment handler per individual agent
  const handleAssignPortfolioToAgent = async (agentId: string, assignedUploadedClients: Client[], replace: boolean) => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) return;

    // Filter only active clients
    const activeUploaded = assignedUploadedClients.filter((c) => {
      const s = String(c.estatus || c.status || '').toUpperCase();
      return !s.includes('INACT') && !s.includes('BAJA') && !s.includes('CANCEL');
    });

    const newCodes = activeUploaded.map((c) => c.code.toUpperCase());

    // Update localStorage manual assignments
    let storedAssignments: Record<string, string[]> = {};
    try {
      const raw = localStorage.getItem('red_manual_assignments');
      if (raw) storedAssignments = JSON.parse(raw);
    } catch {}

    if (replace || !storedAssignments[agentId]) {
      storedAssignments[agentId] = newCodes;
    } else {
      storedAssignments[agentId] = Array.from(new Set([...(storedAssignments[agentId] || []), ...newCodes]));
    }
    localStorage.setItem('red_manual_assignments', JSON.stringify(storedAssignments));

    // Also notify backend API asynchronously
    fetch('/api/cartera/asignar-agente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        agentName: targetAgent.name,
        clientCodes: storedAssignments[agentId],
        replace,
      }),
    }).catch(console.warn);

    // Update clients state
    setClients((prev) => {
      // If replace, clear assignment on clients previously belonging to this agent that are not in the new list
      let updated = prev.map((c) => {
        const upperCode = c.code.toUpperCase();
        if (newCodes.includes(upperCode)) {
          return {
            ...c,
            assignedAgentId: agentId,
            assignedAgentName: targetAgent.name,
            isManualAssignment: true,
          };
        }
        if (replace && c.assignedAgentId === agentId && !newCodes.includes(upperCode)) {
          return {
            ...c,
            assignedAgentId: undefined,
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
          assignedAgentName: targetAgent.name,
          isManualAssignment: true,
        }));

      updated = [...updated, ...missingClients];

      // Update agent stats
      const assignedCount = updated.filter((c) => c.country === targetAgent.country && (!c.assignedAgentId || c.assignedAgentId === agentId)).length;
      const managedCount = updated.filter((c) => c.country === targetAgent.country && (!c.assignedAgentId || c.assignedAgentId === agentId) && c.state === 'Resuelto').length;

      setAgents((prevAgents) =>
        prevAgents.map((ag) =>
          ag.id === agentId
            ? {
                ...ag,
                assignedCount,
                managedCount,
                pendingCount: Math.max(0, assignedCount - managedCount),
                effectivenessRate: assignedCount > 0 ? Number(((managedCount / assignedCount) * 100).toFixed(1)) : 0.0,
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

    let storedAssignments: Record<string, string[]> = {};
    try {
      const raw = localStorage.getItem('red_manual_assignments');
      if (raw) storedAssignments = JSON.parse(raw);
    } catch {}

    delete storedAssignments[agentId];
    localStorage.setItem('red_manual_assignments', JSON.stringify(storedAssignments));

    fetch(`/api/cartera/asignaciones/${agentId}`, { method: 'DELETE' }).catch(console.warn);

    // Re-distribute
    setClients((prev) => {
      const unassigned = prev.map((c) =>
        c.assignedAgentId === agentId ? { ...c, assignedAgentId: undefined, isManualAssignment: false } : c
      );
      return distributeClientsEqually(unassigned, agents);
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
        const next = [auditRecord, ...prev.filter((a) => a.id !== auditRecord.id)];
        try {
          localStorage.setItem('red_gestiones_auditoria', JSON.stringify(next));
        } catch (e) {
          console.warn('Storage audit error:', e);
        }
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
          const assigned = updatedClients.filter((c) => c.country === ag.country && (!c.assignedAgentId || c.assignedAgentId === ag.id));
          const count = assigned.length;
          const managed = assigned.filter((c) => c.state === 'Resuelto').length;
          return {
            ...ag,
            assignedCount: count,
            managedCount: managed,
            pendingCount: Math.max(0, count - managed),
            effectivenessRate: count > 0 ? Number(((managed / count) * 100).toFixed(1)) : 0.0,
          };
        })
      );
      
      return updatedClients;
    });

    setSelectedClientForGestion(null);
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
      agentId: targetClient.assignedAgentId || currentUser?.id || '',
      agentName: targetClient.assignedAgentName || currentUser?.name || 'Agente',
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
      const next = [auditRecord, ...previous];
      try {
        localStorage.setItem('red_gestiones_auditoria', JSON.stringify(next));
      } catch {}
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

  // If user is not authenticated, render LoginScreen
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
    ? matchedAgentForUser || agents.find((a) => a.country === currentCountry) || agents[0]
    : agents.find((a) => a.country === currentCountry && a.role === 'agente') || agents[0];
  const reportAuditLog = mergeManagementRecords(auditLog, clients);

  return (
    <div data-theme={isLightMode ? 'light' : 'dark'} className="min-h-screen bg-slate-950 text-slate-100 flex antialiased">
      <Navbar
        currentUser={currentUser}
        onLogout={handleLogout}
        currentCountry={currentCountry}
        activeModule={activeModule}
        onNavigate={handleNavigateModule}
        onCountryChange={(c) => {
          setCurrentCountry(c);
          setSelectedRangeFilter('TODOS');
        }}
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
                  clientsPerDay={clientsPerDay}
                  onUpdateClientsPerDay={setClientsPerDay}
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
                  clients={clients}
                  dynamicFields={dynamicFields}
                  onUpdateDynamicFields={handleUpdateDynamicFields}
                  onAddAgent={handleAddAgent}
                  onDistributeCartera={handleDistributeCartera}
                  criticalClients={[]}
                  onEscalateClient={handleEscalateClient}
                  clientsPerDay={clientsPerDay}
                  onUpdateClientsPerDay={setClientsPerDay}
                  messageScripts={messageScripts}
                  onUpdateMessageScripts={setMessageScripts}
                  onAssignPortfolioToAgent={handleAssignPortfolioToAgent}
                  onClearAgentManualAssignment={handleClearAgentManualAssignment}
                  activeModule={activeModule}
                  auditLog={auditLog}
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
          agents={agents}
          onAddAgent={({ name, country, pbxExtension, phone }) => {
            handleAddAgent({
              name,
              country,
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
