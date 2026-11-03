import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Clock, Zap } from 'lucide-react';
import { authenticatedApiFetch } from '../services/authService';

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

  useEffect(() => {
    authenticatedApiFetch('/api/sync/status')
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.syncLog)) setSyncLogs(data.syncLog);
      })
      .catch(console.warn);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await onTriggerSync();
      const response = await authenticatedApiFetch('/api/sync/status');
      const data = await response.json();
      if (Array.isArray(data.syncLog)) setSyncLogs(data.syncLog);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSyncing(false);
    }
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
                Monitoreo de SAP y actualización de la cartera de tu país
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 font-medium">Estado del Auto-Sync</div>
              <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Activo</span>
              </div>
            </div>
            <Clock className="w-5 h-5 text-slate-500" />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 font-medium">Última Sincronización</div>
              <div className="text-xs font-mono font-bold text-slate-200 mt-0.5">
                {lastSyncTimestamp ? new Date(lastSyncTimestamp).toLocaleTimeString() : 'Sin registro'}
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

        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Registro de Actividad de Sincronización (SAP)
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 max-h-36 overflow-y-auto space-y-1">
            {syncLogs.length > 0 ? (
              syncLogs.map((log, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-blue-400">›</span>
                  <span>{log}</span>
                </div>
              ))
            ) : (
              <div className="text-slate-500">Sin registros disponibles.</div>
            )}
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-800">
          <span className="text-xs font-bold text-slate-300">Automatización segura</span>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400">
            La sincronización se ejecuta desde el servidor. Las claves de SAP y los secretos de cron
            deben permanecer en las variables de entorno de Vercel, nunca en el navegador ni en este
            panel.
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
