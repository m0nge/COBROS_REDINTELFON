import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock, Eye, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Client, GestionAuditRecord } from '../types';
import { authenticatedApiFetch } from '../services/authService';
import { sortClientManagementHistory } from '../utils/clientManagementHistory';

interface ClientManagementHistoryProps {
  client: Client;
  onViewRecord: (record: GestionAuditRecord) => void;
}

export const ClientManagementHistory: React.FC<ClientManagementHistoryProps> = ({
  client,
  onViewRecord,
}) => {
  const [records, setRecords] = useState<GestionAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const refreshAfterSave = () => setRefreshKey((key) => key + 1);
    const loadHistory = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          action: 'historial-cliente',
          pais: client.country,
          codigo_cliente: client.code,
        });
        const response = await authenticatedApiFetch(`/api/cartera?${params.toString()}`, {
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success || !Array.isArray(payload.records)) {
          throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
        }
        if (!active) return;
        setRecords(sortClientManagementHistory(payload.records as GestionAuditRecord[], client.country, client.code));
        setTruncated(payload.truncated === true);
      } catch (loadError) {
        if (active) {
          setRecords([]);
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el historial desde la base de datos.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadHistory();
    window.addEventListener('red-cobranza:audit-sync-complete', refreshAfterSave);
    return () => {
      active = false;
      window.removeEventListener('red-cobranza:audit-sync-complete', refreshAfterSave);
    };
  }, [client.code, client.country, refreshKey]);

  return (
    <div className="space-y-3 rounded-xl border border-blue-900/50 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-blue-200">
            Historial completo de {client.name}
          </h4>
          <p className="mt-1 text-[11px] text-slate-400">
            {client.code} · Registros guardados en la bitácora de Supabase
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-5 text-xs text-slate-400">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Consultando todas las gestiones guardadas…
        </div>
      ) : error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 p-3 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No se pudo consultar el historial en la base de datos: {error}</span>
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-5 text-center text-xs text-slate-400">
          No hay gestiones guardadas para este cliente.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-slate-400">
            {records.length} {records.length === 1 ? 'gestión registrada' : 'gestiones registradas'}
            {truncated && ' · Se alcanzó el límite de consulta; el historial puede estar incompleto.'}
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {records.map((record) => (
              <div
                key={record.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-blue-200">
                      <Clock className="h-3.5 w-3.5" />
                      {record.date} · {record.time || 'Hora no registrada'}
                    </span>
                    <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200">
                      {record.channel || 'Canal no registrado'}
                    </span>
                    {record.durationSeconds !== undefined && (
                      <span className="text-[10px] text-slate-400">
                        {Math.floor(record.durationSeconds / 60)}m {record.durationSeconds % 60}s
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs font-semibold text-slate-100">
                    {record.agreement || record.status || 'Gestión registrada'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {record.agentName}
                    {record.committedAmount !== undefined
                      ? ` · Monto: ${client.country === 'GT' ? 'Q' : '$'}${Number(record.committedAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                      : ''}
                    {record.deadlineDate ? ` · Fecha compromiso: ${record.deadlineDate}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onViewRecord(record)}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-blue-700/60 bg-blue-950/50 px-3 py-2 text-[11px] font-semibold text-blue-200 hover:bg-blue-900/60"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Ver detalle
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
