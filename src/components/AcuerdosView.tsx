import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Client, Country, PaymentAgreement, Agent } from '../types';
import {
  CircleDollarSign,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Download,
  Calendar,
  Phone,
  MessageSquare,
  FileSpreadsheet,
  X,
  ExternalLink,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

interface AcuerdosViewProps {
  currentCountry: Country;
  clients: Client[];
  agents: Agent[];
  currentAgent?: Agent;
  onOpenGestionModal?: (client: Client) => void;
  isAdmin?: boolean;
}

export const AcuerdosView: React.FC<AcuerdosViewProps> = ({
  currentCountry,
  clients,
  agents,
  currentAgent,
  onOpenGestionModal,
  isAdmin = false,
}) => {
  const [agreements, setAgreements] = useState<PaymentAgreement[]>(() => {
    try {
      const saved = localStorage.getItem('red_acuerdos_promesas');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'Pendiente' | 'Cumplido' | 'Vencido'>('TODOS');
  const [isNewAgreementModalOpen, setIsNewAgreementModalOpen] = useState(false);
  const [isFulfillModalOpen, setIsFulfillModalOpen] = useState(false);
  const [selectedAgreementForFulfill, setSelectedAgreementForFulfill] = useState<PaymentAgreement | null>(null);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [fulfillNotes, setFulfillNotes] = useState('');

  // Form for new agreement
  const [newClientCode, setNewClientCode] = useState('');
  const [newAgreedAmount, setNewAgreedAmount] = useState<number | ''>('');
  const [newPromiseDate, setNewPromiseDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  });
  const [newInstallments, setNewInstallments] = useState(1);
  const [newNotes, setNewNotes] = useState('');

  // Seed initial agreements based on clients if empty
  useEffect(() => {
    if (agreements.length === 0 && clients.length > 0) {
      const activeClientsCountry = clients.filter(
        (c) => c.country === currentCountry && (c.totalDebt || 0) > 0
      );

      const today = new Date();
      const generatedSeeds: PaymentAgreement[] = activeClientsCountry.slice(0, 10).map((c, index) => {
        const debt = c.totalDebt || 500;
        const isFulfilled = index % 3 === 0;
        const isExpired = index === 7;
        const daysOffset = isFulfilled ? -3 : isExpired ? -5 : (index + 2);
        const pDate = new Date(today);
        pDate.setDate(today.getDate() + daysOffset);

        const assignedAg = agents.find((a) => a.id === c.assignedAgentId) || agents[0];

        return {
          id: `ac-${c.code}-${index}`,
          clientCode: c.code,
          clientName: c.name,
          country: c.country,
          agreedAmount: Math.round(isFulfilled ? debt : debt * 0.6),
          totalDebt: debt,
          agreementDate: new Date(today.getTime() - 86400000 * (index + 4)).toISOString().split('T')[0],
          promiseDate: pDate.toISOString().split('T')[0],
          status: isFulfilled ? 'Cumplido' : isExpired ? 'Vencido' : 'Pendiente',
          installments: index % 2 === 0 ? 1 : 2,
          agentId: assignedAg?.id || 'ag-maria',
          agentName: assignedAg?.name || 'María Rodríguez',
          phone: c.phone1 || c.celular || '2250-8000',
          notes: isFulfilled
            ? 'Pago liquidado mediante transferencia bancaria.'
            : 'Cliente promete cancelación al recibir contraprestación de proyecto.',
          receiptNumber: isFulfilled ? `REC-${202600 + index}` : undefined,
          fulfilledDate: isFulfilled ? new Date(today.getTime() - 86400000 * 2).toISOString().split('T')[0] : undefined,
        };
      });

      setAgreements(generatedSeeds);
      try {
        localStorage.setItem('red_acuerdos_promesas', JSON.stringify(generatedSeeds));
      } catch {}
    }
  }, [clients, currentCountry]);

  // Save agreements to localStorage whenever updated
  const saveAgreements = (updated: PaymentAgreement[]) => {
    setAgreements(updated);
    try {
      localStorage.setItem('red_acuerdos_promesas', JSON.stringify(updated));
    } catch {}
  };

  const filteredAgreements = useMemo(() => {
    return agreements.filter((a) => {
      if (a.country !== currentCountry) return false;
      if (!isAdmin && currentAgent && a.agentId && a.agentId !== currentAgent.id) {
        // Collectors view their own or general country agreements
      }
      if (statusFilter !== 'TODOS' && a.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchCode = a.clientCode.toLowerCase().includes(q);
        const matchName = a.clientName.toLowerCase().includes(q);
        const matchAgent = a.agentName.toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchAgent) return false;
      }
      return true;
    });
  }, [agreements, currentCountry, statusFilter, searchTerm, isAdmin, currentAgent]);

  // Financial KPIs
  const countryAgreements = agreements.filter((a) => a.country === currentCountry);
  const totalAgreed = countryAgreements.reduce((sum, a) => sum + (a.agreedAmount || 0), 0);
  const fulfilledAgreements = countryAgreements.filter((a) => a.status === 'Cumplido');
  const fulfilledAmount = fulfilledAgreements.reduce((sum, a) => sum + (a.agreedAmount || 0), 0);
  const pendingAgreements = countryAgreements.filter((a) => a.status === 'Pendiente');
  const pendingAmount = pendingAgreements.reduce((sum, a) => sum + (a.agreedAmount || 0), 0);
  const expiredAgreements = countryAgreements.filter((a) => a.status === 'Vencido');
  const fulfillmentRate = totalAgreed > 0 ? ((fulfilledAmount / totalAgreed) * 100).toFixed(1) : '0.0';

  const handleCreateAgreement = (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find((c) => c.code.toUpperCase() === newClientCode.toUpperCase() || c.name.toLowerCase() === newClientCode.toLowerCase());
    if (!client) {
      alert('Código o nombre de cliente no encontrado en la cartera actual.');
      return;
    }
    if (!newAgreedAmount || Number(newAgreedAmount) <= 0) {
      alert('Ingresa un monto válido mayor a $0.');
      return;
    }

    const assignedAg = agents.find((a) => a.id === client.assignedAgentId) || currentAgent || agents[0];

    const newAgreement: PaymentAgreement = {
      id: `ac-${Date.now()}`,
      clientCode: client.code,
      clientName: client.name,
      country: client.country,
      agreedAmount: Number(newAgreedAmount),
      totalDebt: client.totalDebt || Number(newAgreedAmount),
      agreementDate: new Date().toISOString().split('T')[0],
      promiseDate: newPromiseDate,
      status: 'Pendiente',
      installments: newInstallments,
      agentId: assignedAg?.id || 'ag-current',
      agentName: assignedAg?.name || 'Agente de Cobro',
      phone: client.phone1 || client.celular,
      notes: newNotes.trim() || 'Acuerdo de pago registrado directamente.',
    };

    saveAgreements([newAgreement, ...agreements]);
    setIsNewAgreementModalOpen(false);
    setNewClientCode('');
    setNewAgreedAmount('');
    setNewNotes('');
  };

  const handleMarkAsFulfilled = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgreementForFulfill) return;

    const updated = agreements.map((a) => {
      if (a.id === selectedAgreementForFulfill.id) {
        return {
          ...a,
          status: 'Cumplido' as const,
          receiptNumber: receiptNumber.trim() || `REC-${Date.now().toString().slice(-6)}`,
          fulfilledDate: new Date().toISOString().split('T')[0],
          notes: fulfillNotes.trim() ? `${a.notes ? a.notes + ' | ' : ''}${fulfillNotes.trim()}` : a.notes,
        };
      }
      return a;
    });

    saveAgreements(updated);
    setIsFulfillModalOpen(false);
    setSelectedAgreementForFulfill(null);
    setReceiptNumber('');
    setFulfillNotes('');
  };

  const handleExportExcel = () => {
    const headers = [
      'ID Acuerdo',
      'Código Cliente',
      'Nombre Cliente',
      'País',
      'Monto Acordado',
      'Deuda Total',
      'Fecha Acuerdo',
      'Fecha Prometida',
      'Estado',
      'Cuotas',
      'Gestor Responsable',
      'Teléfono',
      'No. Comprobante',
      'Fecha Cumplimiento',
      'Observaciones',
    ];

    const currencySymbol = currentCountry === 'SV' ? '$' : 'Q';
    const rows = filteredAgreements.map((a) => [
      a.id,
      a.clientCode,
      a.clientName,
      a.country === 'SV' ? 'El Salvador' : 'Guatemala',
      a.agreedAmount,
      a.totalDebt,
      a.agreementDate,
      a.promiseDate,
      a.status,
      a.installments || 1,
      a.agentName,
      a.phone || '',
      a.receiptNumber || '',
      a.fulfilledDate || '',
      a.notes || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 15 },
      { wch: 14 },
      { wch: 35 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 12 },
      { wch: 8 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 40 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Acuerdos y Promesas');
    XLSX.writeFile(wb, `Acuerdos_Promesas_${currentCountry}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-1.5">
            <CircleDollarSign className="w-4 h-4 text-emerald-400" />
            <span>Módulo de Compromisos y Cierre Financiero · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Gestión y Control de Acuerdos de Pago
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Supervisa en tiempo real las promesas de pago pactadas por los agentes, registra cumplimientos con número de recibo y da seguimiento a plazos vencidos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Exportar Excel</span>
          </button>

          <button
            onClick={() => setIsNewAgreementModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Nuevo Acuerdo</span>
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Total Pactado en Acuerdos</span>
            <CircleDollarSign className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black font-mono text-white mt-2 tabular-nums">
            {currentCountry === 'SV' ? '$' : 'Q'}{totalAgreed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-mono">
            {countryAgreements.length} compromisos registrados
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Recuperado (Cumplidos)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-400 mt-2 tabular-nums">
            {currentCountry === 'SV' ? '$' : 'Q'}{fulfilledAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-emerald-400/90 mt-1 font-mono font-semibold">
            {fulfilledAgreements.length} acuerdos pagados ({fulfillmentRate}% tasa de efectividad)
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Promesas Pendientes</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-300 mt-2 tabular-nums">
            {currentCountry === 'SV' ? '$' : 'Q'}{pendingAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-amber-400/90 mt-1 font-mono">
            {pendingAgreements.length} en espera de fecha prometida
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Acuerdos Vencidos / Rotos</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-black font-mono text-red-400 mt-2 tabular-nums">
            {expiredAgreements.length}
          </div>
          <div className="text-[11px] text-red-400/90 mt-1 font-mono">
            Requieren llamada urgente de renegociación
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por cliente, código o gestor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto">
          {(['TODOS', 'Pendiente', 'Cumplido', 'Vencido'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? st === 'Cumplido'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : st === 'Vencido'
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                    : 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
              }`}
            >
              {st === 'TODOS' ? 'Todos los Estados' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Table of Agreements */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4 font-mono">Cód. Cliente</th>
                <th className="py-3 px-4">Cliente Real</th>
                <th className="py-3 px-4 text-right">Monto Pactado</th>
                <th className="py-3 px-4 text-center">Fecha Prometida</th>
                <th className="py-3 px-4 text-center">Estado</th>
                <th className="py-3 px-4">Gestor</th>
                <th className="py-3 px-4">Observaciones / Comprobante</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {filteredAgreements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No se encontraron acuerdos de pago con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredAgreements.map((agr) => {
                  const clientObj = clients.find((c) => c.code === agr.clientCode);

                  return (
                    <tr key={agr.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-blue-400">
                        {agr.clientCode}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white truncate max-w-xs">{agr.clientName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">Deuda total: ${agr.totalDebt.toLocaleString()}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-300 tabular-nums">
                        {currentCountry === 'SV' ? '$' : 'Q'}{agr.agreedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        {agr.installments && agr.installments > 1 && (
                          <div className="text-[10px] text-slate-400 font-normal">en {agr.installments} cuotas</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        <div className="text-slate-200">{agr.promiseDate}</div>
                        <div className="text-[10px] text-slate-500">Pactado el {agr.agreementDate}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            agr.status === 'Cumplido'
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                              : agr.status === 'Vencido'
                              ? 'bg-red-950/80 text-red-300 border-red-600/50'
                              : 'bg-amber-950/80 text-amber-300 border-amber-600/50'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              agr.status === 'Cumplido'
                                ? 'bg-emerald-400'
                                : agr.status === 'Vencido'
                                ? 'bg-red-400'
                                : 'bg-amber-400'
                            }`}
                          />
                          {agr.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-medium">
                        {agr.agentName}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        {agr.receiptNumber && (
                          <div className="text-emerald-400 font-mono text-[11px] font-bold mb-0.5">
                            Comprobante: {agr.receiptNumber}
                          </div>
                        )}
                        <div className="text-slate-400 truncate text-[11px]" title={agr.notes}>
                          {agr.notes || 'Sin observaciones'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {agr.status !== 'Cumplido' && (
                            <button
                              onClick={() => {
                                setSelectedAgreementForFulfill(agr);
                                setIsFulfillModalOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition-all cursor-pointer"
                              title="Marcar como cumplido / registrar pago"
                            >
                              Registrar Pago
                            </button>
                          )}

                          {clientObj && onOpenGestionModal && (
                            <button
                              onClick={() => onOpenGestionModal(clientObj)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                              title="Abrir bitácora y gestión del cliente"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
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

      {/* Modal Registrar Nuevo Acuerdo */}
      {isNewAgreementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl glass-panel border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CircleDollarSign className="w-5 h-5 text-emerald-400" />
                Registrar Compromiso de Pago
              </h3>
              <button
                onClick={() => setIsNewAgreementModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAgreement} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Cliente o Código SAP *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: CL000519 o nombre de empresa"
                  value={newClientCode}
                  onChange={(e) => setNewClientCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Monto Comprometido ({currentCountry === 'SV' ? '$' : 'Q'}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={newAgreedAmount}
                    onChange={(e) => setNewAgreedAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Fecha Prometida de Pago *
                  </label>
                  <input
                    type="date"
                    required
                    value={newPromiseDate}
                    onChange={(e) => setNewPromiseDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Plan en Cuotas
                </label>
                <select
                  value={newInstallments}
                  onChange={(e) => setNewInstallments(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input text-white"
                >
                  <option value={1} className="bg-slate-900">1 Cuota única (Pago total)</option>
                  <option value={2} className="bg-slate-900">2 Cuotas quincenales</option>
                  <option value={3} className="bg-slate-900">3 Cuotas mensuales</option>
                  <option value={4} className="bg-slate-900">4 Cuotas semanales</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Observaciones / Términos del Acuerdo
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles acordados con el cliente..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
                />
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewAgreementModalOpen(false)}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/30 cursor-pointer"
                >
                  Guardar Acuerdo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Marcar Acuerdo Cumplido */}
      {isFulfillModalOpen && selectedAgreementForFulfill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl glass-panel border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Registrar Pago de Promesa
              </h3>
              <button
                onClick={() => setIsFulfillModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="text-xs font-bold text-white">{selectedAgreementForFulfill.clientName}</div>
              <div className="text-[11px] text-slate-400 font-mono">
                Cód: <span className="text-blue-400">{selectedAgreementForFulfill.clientCode}</span> · Monto: <span className="text-emerald-400 font-bold">${selectedAgreementForFulfill.agreedAmount.toLocaleString()}</span>
              </div>
            </div>

            <form onSubmit={handleMarkAsFulfilled} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Número de Comprobante / Recibo de Pago *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: REC-992384 o Ref. Transferencia"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono text-white placeholder:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Notas de Confirmación
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej: Transferencia acreditada en cuenta del BAC..."
                  value={fulfillNotes}
                  onChange={(e) => setFulfillNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
                />
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsFulfillModalOpen(false)}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/30 cursor-pointer"
                >
                  Confirmar Pago Recibido
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
