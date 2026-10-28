import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Client, Country, MoraRange, Priority } from '../types';
import {
  Phone,
  PhoneCall,
  Search,
  Filter,
  AlertCircle,
  Clock,
  CircleDollarSign,
  MessageSquare,
  Download,
  Calendar,
  ExternalLink,
  Flame,
  CheckCircle2,
  Users,
} from 'lucide-react';

interface NoContactadosViewProps {
  currentCountry: Country;
  clients: Client[];
  onOpenGestionModal: (client: Client) => void;
  isAdmin?: boolean;
}

export const NoContactadosView: React.FC<NoContactadosViewProps> = ({
  currentCountry,
  clients,
  onOpenGestionModal,
  isAdmin = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [rangeFilter, setRangeFilter] = useState<MoraRange | 'TODOS'>('TODOS');
  const [priorityFilter, setPriorityFilter] = useState<'TODOS' | Priority>('TODOS');

  // Filter clients who have no successful management or are pending/no contactado
  const uncontactedClients = useMemo(() => {
    return clients
      .filter((c) => {
        if (c.country !== currentCountry) return false;
        // Filter out inactive clients
        const s = String(c.estatus || c.status || '').toUpperCase();
        if (s.includes('INACT') || s.includes('BAJA') || s.includes('CANCEL') || s.includes('SUSPEND') || s === 'NO ACTIVO') {
          return false;
        }

        // Must be uncontacted or not resolved
        const isNotResolved = c.state !== 'Resuelto';
        const hasNoGestiones = !c.managementHistory || c.managementHistory.length === 0;
        const isMarkedNoContactado = c.state === 'No Contactado' || !c.lastManagementDate;

        return isNotResolved || hasNoGestiones || isMarkedNoContactado;
      })
      .filter((c) => {
        if (rangeFilter !== 'TODOS' && c.moraRange !== rangeFilter) return false;
        if (priorityFilter !== 'TODOS' && c.priority !== priorityFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchCode = (c.code || '').toLowerCase().includes(q);
          const matchName = (c.name || '').toLowerCase().includes(q);
          const matchPhone = (c.phone1 || c.celular || '').includes(q);
          if (!matchCode && !matchName && !matchPhone) return false;
        }
        return true;
      })
      .sort((a, b) => (b.daysArrears || 0) - (a.daysArrears || 0));
  }, [clients, currentCountry, rangeFilter, priorityFilter, searchTerm]);

  // Aggregate metrics
  const totalUncontacted = uncontactedClients.length;
  const totalDebtAtRisk = uncontactedClients.reduce((sum, c) => sum + (c.totalDebt || 0), 0);
  const highPriorityCount = uncontactedClients.filter((c) => c.priority === 'Alta' || c.daysArrears > 60).length;
  const avgDaysArrears = totalUncontacted > 0
    ? Math.round(uncontactedClients.reduce((sum, c) => sum + (c.daysArrears || 0), 0) / totalUncontacted)
    : 0;

  const handleOpenWhatsApp = (client: Client) => {
    const rawPhone = client.celular || client.phone1 || client.phone2 || '';
    const digits = rawPhone.replace(/\D/g, '');
    if (!digits) {
      alert(`El cliente ${client.name} no cuenta con número de teléfono registrado.`);
      return;
    }
    const countryPrefix = currentCountry === 'SV' ? '503' : '502';
    const finalPhone = digits.length <= 8 ? `${countryPrefix}${digits}` : digits;

    const message = encodeURIComponent(
      `Estimado(a) ${client.name}, le saludamos cordialmente del departamento de cobranza de RED ${
        currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'
      }. Nos comunicamos para brindarle seguimiento a su cuenta pendiente por un saldo de ${
        currentCountry === 'SV' ? '$' : 'Q'
      }${client.totalDebt.toLocaleString(
        'en-US'
      )}. Por favor indíquenos una fecha conveniente para coordinar su pago. Quedamos a su disposición.`
    );

    window.open(`https://wa.me/${finalPhone}?text=${message}`, '_blank');
  };

  const handleExportExcel = () => {
    const headers = [
      'Código Cliente',
      'Nombre Cliente',
      'País',
      'Días Mora',
      'Rango Mora',
      'Deuda Total',
      'Prioridad',
      'Estado',
      'Teléfono 1',
      'Celular',
      'Gestor Asignado',
      'Horario Sugerido',
    ];

    const rows = uncontactedClients.map((c) => [
      c.code,
      c.name,
      c.country === 'SV' ? 'El Salvador' : 'Guatemala',
      c.daysArrears,
      c.moraRange,
      c.totalDebt,
      c.priority || 'Normal',
      c.state,
      c.phone1 || '',
      c.celular || '',
      c.assignedAgentName || 'María Rodríguez',
      c.scheduledTime || '08:00 AM',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 15 },
      { wch: 35 },
      { wch: 14 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 16 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'No Contactados');
    XLSX.writeFile(wb, `Cartera_No_Contactada_${currentCountry}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-widest mb-1.5">
            <Phone className="w-4 h-4 text-amber-400" />
            <span>Cola de Contacto Inmediato · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Clientes Sin Contacto Registrado
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Cuentas pendientes que aún no han sido gestionadas o no tienen contacto exitoso. Prioriza llamadas por antigüedad de mora y saldo para maximizar la recuperación.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Descargar Lista Excel</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Cuentas Sin Contactar</span>
            <Users className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-300 mt-2 tabular-nums">
            {totalUncontacted}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            Clientes en espera de primera llamada
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Saldo en Riesgo Sin Tocar</span>
            <CircleDollarSign className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-black font-mono text-red-400 mt-2 tabular-nums">
            {currentCountry === 'SV' ? '$' : 'Q'}{totalDebtAtRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            Monto acumulado por cobrar
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Alta Prioridad / Críticos</span>
            <Flame className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-2xl font-black font-mono text-orange-400 mt-2 tabular-nums">
            {highPriorityCount}
          </div>
          <div className="text-[11px] text-orange-400/90 mt-1 font-mono">
            Cuentas con más de 60 días de atraso
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Antigüedad Promedio</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black font-mono text-blue-300 mt-2 tabular-nums">
            {avgDaysArrears} días
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            Promedio de mora en cartera activa
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por cliente, código o teléfono..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Mora range filter buttons */}
          {(['TODOS', '0-30', '31-60', '61-90', '91-120', '120+'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRangeFilter(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                rangeFilter === r
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
              }`}
            >
              {r === 'TODOS' ? 'Todos los rangos' : `${r} días`}
            </button>
          ))}
        </div>
      </div>

      {/* Table of Uncontacted Clients */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4 font-mono">Cód. Cliente</th>
                <th className="py-3 px-4">Cliente Real (SAP)</th>
                <th className="py-3 px-4 text-center">Días Mora</th>
                <th className="py-3 px-4 text-right">Deuda Total</th>
                <th className="py-3 px-4">Contacto Telefónico</th>
                <th className="py-3 px-4 text-center">Prioridad</th>
                <th className="py-3 px-4 text-center">Acciones Directas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {uncontactedClients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    ¡Excelente trabajo! No hay cuentas pendientes sin contactar con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                uncontactedClients.map((client) => {
                  const phoneDisplay = client.phone1 || client.celular || client.telefono || 'Sin registrar';

                  return (
                    <tr key={client.code} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-blue-400">
                        {client.code}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white truncate max-w-xs">{client.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {client.classification || 'Cliente Comercial'} · Gestor: {client.assignedAgentName || 'María Rodríguez'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border ${
                            client.daysArrears > 120
                              ? 'bg-red-950 text-red-300 border-red-700/60'
                              : client.daysArrears > 60
                              ? 'bg-orange-950 text-orange-300 border-orange-700/60'
                              : client.daysArrears > 30
                              ? 'bg-amber-950 text-amber-300 border-amber-700/60'
                              : 'bg-blue-950 text-blue-300 border-blue-700/60'
                          }`}
                        >
                          {client.daysArrears} días
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-white tabular-nums">
                        {currentCountry === 'SV' ? '$' : 'Q'}{client.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        <div>{phoneDisplay}</div>
                        {client.celular && client.celular !== client.phone1 && (
                          <div className="text-[10px] text-slate-500">Móvil: {client.celular}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            client.priority === 'Alta' || client.daysArrears > 90
                              ? 'bg-red-950/80 text-red-300 border border-red-800'
                              : client.priority === 'Media' || client.daysArrears > 60
                              ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {client.daysArrears > 90 ? 'Crítica' : client.priority || 'Normal'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => onOpenGestionModal(client)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
                            title="Llamar y registrar gestión en bitácora"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                            <span>Llamar / Gestionar</span>
                          </button>

                          {(client.celular || client.phone1) && (
                            <button
                              onClick={() => handleOpenWhatsApp(client)}
                              className="p-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer"
                              title="Enviar recordatorio vía WhatsApp Web"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
