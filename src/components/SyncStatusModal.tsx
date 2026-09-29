import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Database, Clock, CheckCircle2, Terminal, Copy, Check, Zap } from 'lucide-react';

interface SyncStatusModalProps {
  onClose: () => void;
  onTriggerSync: () => Promise<void>;
  lastSyncTimestamp: string;
}

export const SyncStatusModal: React.FC<SyncStatusModalProps> = ({
  onClose,
  onTriggerSync,
  lastSyncTimestamp,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/sync/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.syncLog) setSyncLogs(data.syncLog);
      })
      .catch(console.warn);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await onTriggerSync();
      const res = await fetch('/api/sync/status');
      const data = await res.json();
      if (data.syncLog) setSyncLogs(data.syncLog);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  };

  const cronCode = `-- Ejecutar en el SQL Editor de Supabase:
-- Habilitar extensiones de cron y peticiones HTTP
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Programar sincronización cada hora en punto:
SELECT cron.schedule('sync-sap-hourly', '0 * * * *', $$
  PERFORM net.http_get(
    url := 'https://sapapi.red.com.sv/api/Cliente/clienteasignado?var_pais=SV',
    headers := jsonb_build_object('X-API-KEY', 'fdf0cb340b00402c00a057b0f67c00a3')
  );
$$);`;

  const handleCopyCron = () => {
    navigator.clipboard.writeText(cronCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl rounded-2xl glass-panel border border-slate-700 p-6 space-y-5 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Sincronización en Vivo y Actualización</h3>
              <p className="text-xs text-slate-400">
                Monitoreo automático con SAP y actualización en tiempo real de cartera
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current status card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 font-medium">Estado del Auto-Sync</div>
              <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Activo (Cada 3 minutos)</span>
              </div>
            </div>
            <Clock className="w-5 h-5 text-slate-500" />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 font-medium">Última Sincronización</div>
              <div className="text-xs font-mono font-bold text-slate-200 mt-0.5">
                {new Date(lastSyncTimestamp).toLocaleTimeString()}
              </div>
            </div>
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Ya'}</span>
            </button>
          </div>
        </div>

        {/* Sync logs */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Registro de Actividad de Sincronización (SAP)
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 max-h-36 overflow-y-auto space-y-1">
            {syncLogs.length > 0 ? (
              syncLogs.map((log, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-blue-400">›</span>
                  <span>{log}</span>
                </div>
              ))
            ) : (
              <div className="text-slate-500">Cargando registros de sincronización...</div>
            )}
          </div>
        </div>

        {/* Supabase pg_cron integration option */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">
              Automatización nativa en Supabase (pg_cron & Edge)
            </span>
            <button
              onClick={handleCopyCron}
              className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '¡Copiado!' : 'Copiar pg_cron SQL'}</span>
            </button>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400">
            El script <code className="text-emerald-300 font-mono">/supabase_cron_sync.sql</code> está disponible para ejecutar una tarea programada recurrente que actualiza los pagos y nuevos clientes automáticamente desde la nube de Supabase.
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
