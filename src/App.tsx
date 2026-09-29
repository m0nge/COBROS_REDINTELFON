import React, { useState, useEffect } from 'react';
import { Agent, AuthUser, Client, Country, CriticalClient, DynamicField, MoraRange } from './types';
import { INITIAL_AGENTS, INITIAL_DYNAMIC_FIELDS } from './data/mockData';
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
import { Loader2 } from 'lucide-react';

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
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [clients, setClients] = useState<Client[]>([]);
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>(INITIAL_DYNAMIC_FIELDS);

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
      // Distribute 100% of country clients to active agents (María)
      const distributed = distributeClientsEqually(result.clients, agents);
      setClients(distributed);
    } catch (err) {
      console.error('Failed to load SAP portfolio:', err);
    } finally {
      setIsLoadingClients(false);
    }
  };

  useEffect(() => {
    loadCarteraData(currentCountry);
  }, [currentCountry]);

  // Load dynamic fields config from API
  useEffect(() => {
    fetch('/api/configuracion/campos')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.fields)) {
          setDynamicFields(data.fields);
        }
      })
      .catch((err) => console.warn('Could not load dynamic fields config:', err));
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

    // Update agent assigned counts
    setAgents((prev) =>
      prev.map((ag) => {
        if (ag.country !== currentCountry || ag.role !== 'agente') return ag;
        const count = redistributed.filter((c) => c.assignedAgentId === ag.id).length;
        return {
          ...ag,
          assignedCount: count,
          managedCount: redistributed.filter((c) => c.assignedAgentId === ag.id && c.state === 'Resuelto').length,
          pendingCount: redistributed.filter((c) => c.assignedAgentId === ag.id && c.state !== 'Resuelto').length,
        };
      })
    );

    showToast(
      `✓ Cartera de ${currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'} distribuida equitativamente (Lunes a Viernes 8:00 AM - 6:00 PM).`
    );
  };

  // Add agent (e.g. adding a new agent for Guatemala or another for El Salvador)
  const handleAddAgent = (newAgentData: Omit<Agent, 'id' | 'assignedCount' | 'managedCount' | 'pendingCount' | 'effectivenessRate'>) => {
    const newAgent: Agent = {
      ...newAgentData,
      id: `ag-${Date.now()}`,
      effectivenessRate: 88.0,
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

  // Update dynamic fields configuration
  const handleUpdateDynamicFields = (updatedFields: DynamicField[]) => {
    setDynamicFields(updatedFields);
    fetch('/api/configuracion/campos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: updatedFields }),
    }).catch(console.error);

    showToast('✓ Formulario dinámico de bitácora actualizado con éxito.');
  };

  // Save successful gestion
  const handleSaveGestionSuccess = (clientCode: string, updatedProps: Partial<Client>) => {
    setClients((prev) =>
      prev.map((c) => (c.code === clientCode ? { ...c, ...updatedProps } : c))
    );

    // Update agent metrics
    setAgents((prev) =>
      prev.map((ag) => {
        if (ag.id === 'ag-maria') {
          return {
            ...ag,
            managedCount: ag.managedCount + 1,
            pendingCount: Math.max(0, ag.pendingCount - 1),
          };
        }
        return ag;
      })
    );

    setSelectedClientForGestion(null);
    showToast(`✓ Gestión registrada exitosamente. Cliente ${clientCode} marcado como Resuelto.`);
  };

  // Escalate critical client
  const handleEscalateClient = (client: CriticalClient) => {
    setClients((prev) =>
      prev.map((c) =>
        c.code === client.clientCode ? { ...c, state: 'Escalado' as any } : c
      )
    );
    showToast(`⚠️ Cliente crítico ${client.name} (${client.clientCode}) escalado a Cobranza Judicial.`);
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
  const activeAgent =
    currentUser.role === 'agente'
      ? agents.find(
          (a) =>
            a.id === currentUser.id ||
            a.name.toLowerCase() === currentUser.name.toLowerCase() ||
            a.email.toLowerCase() === currentUser.email.toLowerCase()
        ) || agents.find((a) => a.country === currentCountry) || agents[0]
      : agents.find((a) => a.country === currentCountry && a.role === 'agente') || agents[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Top Bar Navigation */}
      <Navbar
        currentUser={currentUser}
        onLogout={handleLogout}
        currentCountry={currentCountry}
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
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
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

        {/* Slide 1: Motor del Sistema: Clasificación Automática */}
        {isMotorMoraVisible && (
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
            {/* View Mode: Operación de Agente (María Rodríguez) */}
            {currentUser.role === 'agente' && (
              <AgentDashboard
                currentCountry={currentCountry}
                agent={activeAgent}
                clients={clients}
                onOpenGestionModal={setSelectedClientForGestion}
                selectedRangeFilter={selectedRangeFilter}
                onSelectRange={setSelectedRangeFilter}
              />
            )}

            {/* View Mode: Administrador Global (Eduardo) */}
            {currentUser.role === 'admin' && (
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
              />
            )}
          </>
        )}
      </main>

      {/* Clean Footer without script buttons */}
      <footer className="border-t border-slate-900 bg-slate-950 py-5 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>RED El Salvador & Guatemala · Sistema de Cobranzas y Recuperación de Cartera</span>
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className="hover:text-blue-400 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Monitoreo en Vivo SAP</span>
          </button>
        </div>
      </footer>

      {/* Slide 5 & Slide 6: Cierre de Acuerdos Modal */}
      {selectedClientForGestion && (
        <GestionModal
          client={selectedClientForGestion}
          onClose={() => setSelectedClientForGestion(null)}
          onSaveGestionSuccess={handleSaveGestionSuccess}
          dynamicFields={dynamicFields}
        />
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
