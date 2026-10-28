import React, { useState, useMemo } from 'react';
import { Client, Country, MoraRange } from '../types';
import {
  Sparkles,
  Zap,
  PhoneCall,
  Clock,
  ShieldAlert,
  AlertTriangle,
  Scale,
  CheckCircle2,
  ChevronRight,
  Filter,
  Search,
  ExternalLink,
  RefreshCw,
  Sliders,
} from 'lucide-react';

interface MotorMoraViewProps {
  currentCountry: Country;
  clients: Client[];
  onOpenGestionModal: (client: Client) => void;
  isAdmin?: boolean;
}

export const MotorMoraView: React.FC<MotorMoraViewProps> = ({
  currentCountry,
  clients,
  onOpenGestionModal,
  isAdmin = false,
}) => {
  const [selectedPhase, setSelectedPhase] = useState<MoraRange | 'TODOS'>('TODOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);

  // Filter country active clients
  const activeClients = useMemo(() => {
    return clients.filter((c) => {
      if (c.country !== currentCountry) return false;
      const s = String(c.estatus || c.status || '').toUpperCase();
      if (s.includes('INACT') || s.includes('BAJA') || s.includes('CANCEL') || s.includes('SUSPEND') || s === 'NO ACTIVO') {
        return false;
      }
      return true;
    });
  }, [clients, currentCountry]);

  // Counts by range
  const countsByRange: Record<MoraRange, number> = {
    '0-30': activeClients.filter((c) => c.moraRange === '0-30').length,
    '31-60': activeClients.filter((c) => c.moraRange === '31-60').length,
    '61-90': activeClients.filter((c) => c.moraRange === '61-90').length,
    '91-120': activeClients.filter((c) => c.moraRange === '91-120').length,
    '120+': activeClients.filter((c) => c.moraRange === '120+').length,
  };

  const debtsByRange: Record<MoraRange, number> = {
    '0-30': activeClients.filter((c) => c.moraRange === '0-30').reduce((sum, c) => sum + (c.totalDebt || 0), 0),
    '31-60': activeClients.filter((c) => c.moraRange === '31-60').reduce((sum, c) => sum + (c.totalDebt || 0), 0),
    '61-90': activeClients.filter((c) => c.moraRange === '61-90').reduce((sum, c) => sum + (c.totalDebt || 0), 0),
    '91-120': activeClients.filter((c) => c.moraRange === '91-120').reduce((sum, c) => sum + (c.totalDebt || 0), 0),
    '120+': activeClients.filter((c) => c.moraRange === '120+').reduce((sum, c) => sum + (c.totalDebt || 0), 0),
  };

  // Tactical playbooks by phase
  const phaseRules: Record<
    MoraRange,
    { title: string; subtitle: string; playbook: string; actionLabel: string; badgeColor: string; icon: any }
  > = {
    '0-30': {
      title: 'Fase 1: Preventiva (0 a 30 días)',
      subtitle: 'Factura dentro de crédito corriente',
      playbook: 'Recordatorio amigable de fecha límite, verificación de recepción de factura y canales de pago en línea.',
      actionLabel: 'Recordatorio Preventivo',
      badgeColor: 'bg-blue-950 text-blue-300 border-blue-700/60',
      icon: Clock,
    },
    '31-60': {
      title: 'Fase 2: Administrativa (31 a 60 días)',
      subtitle: 'Primer mes de morosidad activa',
      playbook: 'Contacto telefónico de cobranza temprana, confirmación de motivo de atraso y solicitud de fecha compromiso.',
      actionLabel: 'Llamada de Cobranza Temprana',
      badgeColor: 'bg-orange-950 text-orange-300 border-orange-700/60',
      icon: PhoneCall,
    },
    '61-90': {
      title: 'Fase 3: Pre-judicial (61 a 90 días)',
      subtitle: 'Segundo mes consecutivo de mora',
      playbook: 'Aviso formal de corte preventivo de servicio, exigencia de saldo vencido y propuesta de pago en 2 cuotas fijas.',
      actionLabel: 'Requerimiento Formal & Cuotas',
      badgeColor: 'bg-yellow-950 text-yellow-300 border-yellow-700/60',
      icon: AlertTriangle,
    },
    '91-120': {
      title: 'Fase 4: Cobranza Crítica (91 a 120 días)',
      subtitle: 'Tercer mes de mora severa',
      playbook: 'Notificación prejudicial de cobro, suspensión total de enlaces/servicios, emplazamiento de pago en 48 horas.',
      actionLabel: 'Emplazamiento Perentorio 48h',
      badgeColor: 'bg-orange-950 text-orange-400 border-orange-600/60',
      icon: ShieldAlert,
    },
    '120+': {
      title: 'Fase 5: Cobro Judicial / Castigo (120+ días)',
      subtitle: 'Morosidad extrema sin respuesta',
      playbook: 'Traspaso de expediente a departamento legal externo para embargo de cuentas o demanda ejecutiva civil.',
      actionLabel: 'Escalamiento Judicial',
      badgeColor: 'bg-red-950 text-red-300 border-red-700/60',
      icon: Scale,
    },
  };

  // Filter clients for queue
  const queueClients = useMemo(() => {
    return activeClients
      .filter((c) => {
        if (selectedPhase !== 'TODOS' && c.moraRange !== selectedPhase) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          return (c.code || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q);
        }
        return true;
      })
      .map((c) => {
        // Calculate dynamic risk score 0 to 100
        let score = 20;
        if (c.daysArrears > 120) score += 60;
        else if (c.daysArrears > 90) score += 45;
        else if (c.daysArrears > 60) score += 30;
        else if (c.daysArrears > 30) score += 15;

        if (c.totalDebt > 5000) score += 20;
        else if (c.totalDebt > 1000) score += 10;

        if (c.state === 'Resuelto') score = Math.max(10, score - 30);

        const riskTier = score >= 75 ? 'Crítico' : score >= 50 ? 'Alto' : score >= 30 ? 'Moderado' : 'Bajo';

        return {
          ...c,
          riskScore: score,
          riskTier,
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [activeClients, selectedPhase, searchTerm]);

  const handleSimulateEngine = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setSimulationMessage(
        `✓ Motor ejecutado con éxito: ${activeClients.length} cuentas reclasificadas y agenda reoptimizada según la regla Día 1-30 crédito y Día 31+ mora.`
      );
      setTimeout(() => setSimulationMessage(null), 4500);
    }, 900);
  };

  const currencySymbol = currentCountry === 'SV' ? '$' : 'Q';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-widest mb-1.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span>Motor Predictivo de Clasificación & Políticas de Mora · SAP ERP</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Motor de Mora y Estrategias por Fase
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Cada cliente recibe su factura al inicio del mes y dispone de 30 días de crédito corriente. Desde el día 31 entra automáticamente en el embudo progresivo de cobranza.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSimulateEngine}
            disabled={isSimulating}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSimulating ? 'animate-spin' : ''}`} />
            <span>{isSimulating ? 'Ejecutando...' : 'Reclasificar Cartera SAP'}</span>
          </button>
        </div>
      </div>

      {simulationMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{simulationMessage}</span>
        </div>
      )}

      {/* 5 Fases Interactivas */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5">
        {(['0-30', '31-60', '61-90', '91-120', '120+'] as const).map((phase) => {
          const rule = phaseRules[phase];
          const isSelected = selectedPhase === phase;
          const Icon = rule.icon;
          const count = countsByRange[phase];
          const debt = debtsByRange[phase];

          return (
            <button
              key={phase}
              onClick={() => setSelectedPhase(isSelected ? 'TODOS' : phase)}
              className={`p-4 rounded-2xl text-left transition-all border flex flex-col justify-between cursor-pointer ${
                isSelected
                  ? 'bg-blue-950/80 border-blue-400 shadow-xl shadow-blue-600/25 ring-1 ring-blue-400'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className={`p-2 rounded-xl bg-slate-950/80 border border-slate-800 text-blue-400`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="font-mono text-xs font-bold text-white">
                    {count} cuentas
                  </span>
                </div>

                <div className="text-sm font-bold text-white">{phase} días</div>
                <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{rule.subtitle}</div>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between font-mono text-[11px]">
                <span className="text-slate-400">Total:</span>
                <span className="font-bold text-slate-200 tabular-nums">
                  {currencySymbol}{debt.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Phase Detail & Playbook */}
      {selectedPhase !== 'TODOS' && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-slate-900/60">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                  Guía de Gestión Operativa · {phaseRules[selectedPhase].title}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${phaseRules[selectedPhase].badgeColor}`}>
                  {selectedPhase} Días de Mora
                </span>
              </div>
              <p className="text-xs text-slate-200 mt-2 leading-relaxed max-w-3xl">
                {phaseRules[selectedPhase].playbook}
              </p>
            </div>

            <button
              onClick={() => setSelectedPhase('TODOS')}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors self-start md:self-auto cursor-pointer"
            >
              Ver todas las fases
            </button>
          </div>
        </div>
      )}

      {/* Action Queue Table */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Cola de Priorización por Scoring de Riesgo ({queueClients.length} cuentas)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Cuentas ordenadas por score de urgencia para maximizar el retorno de la cobranza
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar en la cola..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800 shadow-sm">
              <tr>
                <th className="py-3 px-4 font-mono">Cód. SAP</th>
                <th className="py-3 px-4">Cliente Real</th>
                <th className="py-3 px-4 text-center">Fase Mora</th>
                <th className="py-3 px-4 text-right">Saldo Deuda</th>
                <th className="py-3 px-4 text-center">Nivel de Riesgo</th>
                <th className="py-3 px-4">Estrategia Recomendada</th>
                <th className="py-3 px-4 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {queueClients.slice(0, 50).map((c) => {
                const rule = phaseRules[c.moraRange] || phaseRules['0-30'];

                return (
                  <tr key={c.code} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-blue-400">
                      {c.code}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white truncate max-w-xs">{c.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {c.daysArrears} días de atraso
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="font-mono text-[11px] font-bold text-slate-300">
                        {c.moraRange}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-white tabular-nums">
                      {currencySymbol}{c.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          c.riskTier === 'Crítico'
                            ? 'bg-red-950 text-red-300 border border-red-800'
                            : c.riskTier === 'Alto'
                            ? 'bg-orange-950 text-orange-300 border border-orange-800'
                            : c.riskTier === 'Moderado'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-blue-950 text-blue-300 border border-blue-800'
                        }`}
                      >
                        {c.riskTier} ({c.riskScore} pts)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300 text-[11px]">
                      <span className="text-blue-300 font-semibold">{rule.actionLabel}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => onOpenGestionModal(c)}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
                      >
                        Gestionar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
