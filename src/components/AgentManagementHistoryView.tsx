import React, { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ClipboardList, History, Search } from 'lucide-react';
import type { Agent, Client, Country, DynamicField, GestionAuditRecord } from '../types';
import { isClientAssignedToAgent } from '../types';
import { ClientManagementHistory } from './ClientManagementHistory';
import { GestionReadOnlyModal } from './GestionReadOnlyModal';

interface AgentManagementHistoryViewProps {
  currentCountry: Country;
  agent: Agent;
  clients: Client[];
  dynamicFields: DynamicField[];
  onEditSavedGestion: (record: GestionAuditRecord, client: Client) => void;
}

export const AgentManagementHistoryView: React.FC<AgentManagementHistoryViewProps> = ({
  currentCountry,
  agent,
  clients,
  dynamicFields,
  onEditSavedGestion,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedClientCode, setExpandedClientCode] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<GestionAuditRecord | null>(null);

  const assignedClients = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return clients
      .filter((client) => (
        client.country === currentCountry
        && isClientAssignedToAgent(client, agent.id)
        && !['INACT', 'BAJA', 'CANCEL', 'SUSPEND'].some((status) =>
          String(client.estatus || client.status || '').toLocaleUpperCase().includes(status)
        )
        && String(client.estatus || client.status || '').toLocaleUpperCase() !== 'NO ACTIVO'
      ))
      .filter((client) => !query || [
        client.code,
        client.name,
        client.phone1,
        client.phone2,
        client.celular,
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      .sort((left, right) =>
        left.name.localeCompare(right.name, 'es')
        || left.code.localeCompare(right.code, 'es')
      );
  }, [agent.id, clients, currentCountry, searchTerm]);

  const selectedClient = selectedRecord
    ? clients.find((client) =>
      client.country === selectedRecord.country
      && client.code === selectedRecord.clientCode
      && client.country === currentCountry
      && isClientAssignedToAgent(client, agent.id)
    )
    : undefined;

  return (
    <section id="mis-gestiones" className="glass-panel animate-fade-in space-y-6 rounded-2xl p-6 sm:p-8">
      <header className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
            <ClipboardList className="h-4 w-4" />
            <span>Historial persistido · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Mis gestiones por cliente</h2>
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-slate-400">
            Busca un cliente de tu cartera y abre su historial para consultar las gestiones guardadas en la bitácora, con fecha, canal y detalle.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs font-mono text-slate-300">
          Clientes asignados: <strong className="text-white">{assignedClients.length}</strong>
        </div>
      </header>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar por código, cliente o teléfono..."
          aria-label="Buscar cliente en mis gestiones"
          className="glass-input w-full rounded-xl py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500"
        />
      </div>

      {assignedClients.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-10 text-sm text-slate-400">
          <AlertCircle className="h-4 w-4" />
          No hay clientes asignados que coincidan con la búsqueda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 shadow-inner">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 font-mono">Código</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3 text-center">Mora</th>
                <th className="px-4 py-3">Teléfono</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Historial</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {assignedClients.map((client) => {
                const isExpanded = expandedClientCode === client.code;
                return (
                  <React.Fragment key={`${client.country}:${client.code}`}>
                    <tr className="transition-colors hover:bg-slate-800/40">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-blue-300">
                        {client.code}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-100">{client.name}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {client.department}{client.municipality ? ` · ${client.municipality}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-slate-300">
                        {client.debtVerified === false ? 'Pendiente SAN' : `${client.daysArrears} días`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-300">
                        {client.phone1 || client.celular || client.phone2 || 'Sin teléfono'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
                          client.state === 'Resuelto'
                            ? 'border-emerald-800/70 bg-emerald-950/50 text-emerald-300'
                            : 'border-slate-700 bg-slate-900 text-slate-300'
                        }`}>
                          {client.state || 'Pendiente'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedClientCode((current) => current === client.code ? '' : client.code)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-800/70 bg-blue-950/50 px-3 py-1.5 font-semibold text-blue-200 transition-colors hover:bg-blue-900/60"
                        >
                          <History className="h-3.5 w-3.5" />
                          {isExpanded ? 'Ocultar' : 'Ver gestiones'}
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-slate-950/50 p-3 sm:p-4">
                          <ClientManagementHistory client={client} onViewRecord={setSelectedRecord} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedRecord && (
        <GestionReadOnlyModal
          record={selectedRecord}
          client={selectedClient}
          dynamicFields={dynamicFields}
          onClose={() => setSelectedRecord(null)}
          onEdit={
            selectedClient
            && !selectedRecord.isSharedManagement
            && selectedRecord.agentId === agent.id
              ? () => {
                  onEditSavedGestion(selectedRecord, selectedClient);
                  setSelectedRecord(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
};
