import React from 'react';
import { MoraRange } from '../types';
import { MORA_PHASES } from '../utils/moraLogic';
import { PhoneCall, Calendar, Clock, AlertTriangle, AlertOctagon, CheckCircle2, ChevronRight, Zap } from 'lucide-react';

interface MoraMotorHeaderProps {
  countsByRange: Record<MoraRange, number>;
  selectedRangeFilter: MoraRange | 'TODOS';
  onSelectRange: (range: MoraRange | 'TODOS') => void;
}

export const MoraMotorHeader: React.FC<MoraMotorHeaderProps> = ({
  countsByRange,
  selectedRangeFilter,
  onSelectRange,
}) => {
  return (
    <div className="w-full relative overflow-hidden rounded-2xl p-6 sm:p-8 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950 border border-slate-800/80 shadow-2xl mb-8">
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-1/4 w-96 h-48 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-10 w-96 h-48 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
      
      <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-widest mb-1.5">
            <Zap className="w-3.5 h-3.5" />
            Regla de Negocio: Facturación Día 1 a 30 sin mora, Día 31+ Mora Activa
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            El Motor del Sistema: Clasificación Automática
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Cada cliente recibe su factura al inicio del mes y dispone de 30 días para pagar. Desde el día 31 entra automáticamente en mora progresiva por fases.
          </p>
        </div>

        {selectedRangeFilter !== 'TODOS' && (
          <button
            onClick={() => onSelectRange('TODOS')}
            className="self-start md:self-auto text-xs font-medium text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 transition-colors border border-slate-700"
          >
            Mostrar todos los rangos
          </button>
        )}
      </div>

      {/* Visual Pipeline with glowing stations matching Slide 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4 relative pt-2">
        {/* Phase 1: 0-30 días */}
        <button
          onClick={() => onSelectRange(selectedRangeFilter === '0-30' ? 'TODOS' : '0-30')}
          className={`group text-left p-4 rounded-xl transition-all relative overflow-hidden flex flex-col justify-between border ${
            selectedRangeFilter === '0-30'
              ? 'bg-blue-950/60 border-blue-500 shadow-lg shadow-blue-500/20 ring-1 ring-blue-400'
              : 'bg-slate-900/70 border-slate-800 hover:border-blue-500/50 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-400/50 flex items-center justify-center text-blue-400 shadow-sm shadow-blue-500/20">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-200 border border-blue-700/50">
              {countsByRange['0-30']} clientes
            </span>
          </div>
          <div>
            <div className="text-lg font-bold text-blue-300">0-30 días</div>
            <div className="text-xs font-medium text-slate-300 mt-0.5">No moroso</div>
            <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Factura dentro del período normal de crédito.
            </div>
          </div>
        </button>

        {/* Phase 2: 31-60 días */}
        <button
          onClick={() => onSelectRange(selectedRangeFilter === '31-60' ? 'TODOS' : '31-60')}
          className={`group text-left p-4 rounded-xl transition-all relative overflow-hidden flex flex-col justify-between border ${
            selectedRangeFilter === '31-60'
              ? 'bg-orange-950/60 border-orange-500 shadow-lg shadow-orange-500/20 ring-1 ring-orange-400'
              : 'bg-slate-900/70 border-slate-800 hover:border-orange-500/50 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 border border-orange-400/50 flex items-center justify-center text-orange-400 shadow-sm shadow-orange-500/20">
              <PhoneCall className="w-4 h-4" />
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-orange-900/60 text-orange-200 border border-orange-700/50">
              {countsByRange['31-60']} clientes
            </span>
          </div>
          <div>
            <div className="text-lg font-bold text-orange-300">31-60 días</div>
            <div className="text-xs font-medium text-slate-300 mt-0.5">Primer contacto</div>
            <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Gestión preventiva y verificación de recepción de factura.
            </div>
          </div>
        </button>

        {/* Phase 3: 61-90 días */}
        <button
          onClick={() => onSelectRange(selectedRangeFilter === '61-90' ? 'TODOS' : '61-90')}
          className={`group text-left p-4 rounded-xl transition-all relative overflow-hidden flex flex-col justify-between border ${
            selectedRangeFilter === '61-90'
              ? 'bg-amber-950/60 border-amber-500 shadow-lg shadow-amber-500/20 ring-1 ring-amber-400'
              : 'bg-slate-900/70 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-400 shadow-sm shadow-amber-500/20">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-200 border border-amber-700/50">
              {countsByRange['61-90']} clientes
            </span>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-300">61-90 días</div>
            <div className="text-xs font-medium text-slate-300 mt-0.5">Segundo contacto</div>
            <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Seguimiento moderado y propuesta de facilidades de pago.
            </div>
          </div>
        </button>

        {/* Phase 4: 91-120 días */}
        <button
          onClick={() => onSelectRange(selectedRangeFilter === '91-120' ? 'TODOS' : '91-120')}
          className={`group text-left p-4 rounded-xl transition-all relative overflow-hidden flex flex-col justify-between border ${
            selectedRangeFilter === '91-120'
              ? 'bg-orange-950/80 border-orange-600 shadow-lg shadow-orange-600/20 ring-1 ring-orange-500'
              : 'bg-slate-900/70 border-slate-800 hover:border-orange-600/50 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-full bg-orange-600/20 border border-orange-500/50 flex items-center justify-center text-orange-400 shadow-sm shadow-orange-600/20">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-orange-950 text-orange-200 border border-orange-700/60">
              {countsByRange['91-120']} clientes
            </span>
          </div>
          <div>
            <div className="text-lg font-bold text-orange-400">91-120 días</div>
            <div className="text-xs font-medium text-slate-300 mt-0.5">Tercer contacto</div>
            <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Urgencia: advertencia de suspensión de servicio y recargos.
            </div>
          </div>
        </button>

        {/* Phase 5: 120+ días */}
        <button
          onClick={() => onSelectRange(selectedRangeFilter === '120+' ? 'TODOS' : '120+')}
          className={`group text-left p-4 rounded-xl transition-all relative overflow-hidden flex flex-col justify-between border ${
            selectedRangeFilter === '120+'
              ? 'bg-red-950/80 border-red-500 shadow-lg shadow-red-600/30 ring-1 ring-red-400'
              : 'bg-slate-900/70 border-slate-800 hover:border-red-500/50 hover:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-8 h-8 rounded-full bg-red-600/20 border border-red-400/50 flex items-center justify-center text-red-400 shadow-sm shadow-red-600/20">
              <AlertOctagon className="w-4 h-4" />
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-red-900/70 text-red-200 border border-red-700/60">
              {countsByRange['120+']} clientes
            </span>
          </div>
          <div>
            <div className="text-lg font-bold text-red-400">120+ días</div>
            <div className="text-xs font-medium text-slate-200 mt-0.5">Crítico</div>
            <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Requiere escalación inmediata a cobranza judicial y legal.
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};
