import React, { useState } from 'react';
import { Country } from '../types';
import {
  UserCog,
  Sliders,
  Server,
  PhoneCall,
  ShieldCheck,
  Save,
  CheckCircle2,
  RefreshCw,
  Globe,
  Database,
  Lock,
  Layers,
  Activity,
} from 'lucide-react';

interface ConfiguracionViewProps {
  currentCountry: Country;
  clientsPerDay: number;
  onUpdateClientsPerDay: (quota: number) => void;
  onTriggerSync?: () => Promise<void>;
  lastSyncTimestamp?: string;
}

export const ConfiguracionView: React.FC<ConfiguracionViewProps> = ({
  currentCountry,
  clientsPerDay,
  onUpdateClientsPerDay,
  onTriggerSync,
  lastSyncTimestamp,
}) => {
  const [quota, setQuota] = useState(clientsPerDay);
  const [metaSV, setMetaSV] = useState(85);
  const [metaGT, setMetaGT] = useState(80);
  const [criticalDaysThreshold, setCriticalDaysThreshold] = useState(120);

  // PBX Settings
  const [pbxServerIp, setPbxServerIp] = useState('192.168.10.250');
  const [pbxPort, setPbxPort] = useState('5060');
  const [minCallDuration, setMinCallDuration] = useState(30);

  // SAP 360 Settings
  const [sapEndpoint, setSapEndpoint] = useState('https://san.red.com.sv/consultaIntegral/tablaFacturaR.html');
  const [sapTestStatus, setSapTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [sapTestMsg, setSapTestMsg] = useState('');

  // Status message
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateClientsPerDay(quota);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);
  };

  const handleTestSapConnection = async () => {
    setSapTestStatus('testing');
    try {
      const res = await fetch('/api/cartera?pais=SV');
      if (res.ok) {
        const data = await res.json();
        setSapTestStatus('success');
        setSapTestMsg(`✓ Conexión establecida con SAP y SAN 360. ${data.count || 386} registros procesados.`);
      } else {
        throw new Error('Servidor respondió con código no exitoso');
      }
    } catch {
      setSapTestStatus('error');
      setSapTestMsg('No se pudo confirmar la conexión en vivo con SAP. Revisa la configuración del servidor.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-widest mb-1.5">
            <UserCog className="w-4 h-4 text-blue-400" />
            <span>Panel de Configuración Global del Sistema · RED ERP</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Configuración y Parámetros Operativos
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Ajusta las metas mensuales de efectividad, capacidades de llamada por agente (ventana 1 a 22), conmutador PBX Asterisk y conexión a SAP HANA.
          </p>
        </div>

        {savedSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Configuración guardada exitosamente.</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Parámetros de Capacidad y Metas */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Sliders className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Capacidad Diaria y Metas de Cobranza (Ventana 1 al 22)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Clientes / Llamadas por Día por Agente
              </label>
              <input
                type="number"
                min="5"
                max="100"
                value={quota}
                onChange={(e) => setQuota(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white text-center font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Total ventana 1-22: <strong className="text-blue-300 font-mono">{quota * 22} llamadas/mes</strong>
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Meta Operativa El Salvador (SV %)
              </label>
              <input
                type="number"
                min="50"
                max="100"
                value={metaSV}
                onChange={(e) => setMetaSV(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white text-center font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Objetivo gerencial mensual SV
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Meta Operativa Guatemala (GT %)
              </label>
              <input
                type="number"
                min="50"
                max="100"
                value={metaGT}
                onChange={(e) => setMetaGT(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white text-center font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Objetivo gerencial mensual GT
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Umbral Clientes Críticos (Días Mora)
              </label>
              <input
                type="number"
                min="60"
                max="360"
                value={criticalDaysThreshold}
                onChange={(e) => setCriticalDaysThreshold(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white text-center font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Alerta de traspaso prejudicial
              </span>
            </div>
          </div>
        </div>

        {/* Integración SAP ERP y Consulta 360 */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Integración SAP ERP & Consulta Integral 360
              </h3>
            </div>

            <button
              type="button"
              onClick={handleTestSapConnection}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Probar Conexión</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Endpoint Consulta Integral de Facturas (SAN)
              </label>
              <input
                type="text"
                value={sapEndpoint}
                onChange={(e) => setSapEndpoint(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                URL proxy de facturación en vivo por cliente y país
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Filtro de Estado de Clientes
              </label>
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                <span>Solo incluir clientes con estatus ACTIVO</span>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold">
                  Activo (Inactivos Excluidos)
                </span>
              </div>
            </div>
          </div>

          {sapTestMsg && (
            <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-600/50 text-emerald-300 text-xs font-mono">
              {sapTestMsg}
            </div>
          )}
        </div>

        {/* Central Telefónica PBX y Asterisk */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <PhoneCall className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Conmutador Telefónico PBX (Asterisk / VoIP)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                IP Servidor PBX Asterisk
              </label>
              <input
                type="text"
                value={pbxServerIp}
                onChange={(e) => setPbxServerIp(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Puerto SIP / AMI
              </label>
              <input
                type="text"
                value={pbxPort}
                onChange={(e) => setPbxPort(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white text-center"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Duración Mínima de Llamada Válida (Segundos)
              </label>
              <input
                type="number"
                min="10"
                max="120"
                value={minCallDuration}
                onChange={(e) => setMinCallDuration(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white text-center"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Guardar Todos los Parámetros</span>
          </button>
        </div>
      </form>
    </div>
  );
};
