import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Client, Country, PaymentAgreement, Agent } from '../types';
import { authenticatedApiFetch } from '../services/authService';
import { getElSalvadorDateKey, getElSalvadorDateParts, getRecordDateKey } from '../utils/gestionDates';
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
  Info,
  CalendarDays,
} from 'lucide-react';

interface AcuerdosViewProps {
  currentCountry: Country;
  clients: Client[];
  agents: Agent[];
  currentAgent?: Agent;
  onOpenGestionModal?: (client: Client) => void;
  isAdmin?: boolean;
  onUpdateClientData?: (clientCode: string, updates: Partial<Client>) => void;
  onScheduleFollowUp?: (clientCode: string, targetDate: string, reason?: string) => void;
}

export const AcuerdosView: React.FC<AcuerdosViewProps> = ({
  currentCountry,
  clients,
  agents,
  currentAgent,
  onOpenGestionModal,
  isAdmin = false,
  onScheduleFollowUp,
}) => {
  // Load only REAL agreements from localStorage
  const [agreements, setAgreements] = useState<PaymentAgreement[]>(() => {
    try {
      const saved = localStorage.getItem('red_acuerdos_promesas');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clean out any previously seeded mock data (mock agreements had IDs starting with 'ac-CL0000' or fake receipt REC-20260)
        const onlyReal = parsed.filter(
          (a: any) =>
            !a.id?.startsWith('ac-CL000002-') &&
            !a.id?.startsWith('ac-CL000003-') &&
            !a.id?.startsWith('ac-CL000007-') &&
            !a.id?.startsWith('ac-CL000019-') &&
            !a.id?.startsWith('ac-CL000030-') &&
            !a.id?.startsWith('ac-CL001757-') &&
            !a.id?.startsWith('ac-CL002028-') &&
            !a.id?.startsWith('ac-CL002568-') &&
            !a.receiptNumber?.startsWith('REC-20260')
        );
        return onlyReal;
      }
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
  const [selectedPromiseDate, setSelectedPromiseDate] = useState(getElSalvadorDateKey());
  const [isValidatingPromises, setIsValidatingPromises] = useState(false);
  const [promiseValidationResult, setPromiseValidationResult] = useState('');
  const [followUpDates, setFollowUpDates] = useState<Record<string, string>>({});
  const [unpaidPromises, setUnpaidPromises] = useState<Record<string, string[]>>({});
  const [monthlyResolvedKeys, setMonthlyResolvedKeys] = useState<string[]>([]);

  // Selected agreement for inspection modal
  const [inspectedAgreement, setInspectedAgreement] = useState<PaymentAgreement | null>(null);

  const todayKey = getElSalvadorDateKey();
  const todayParts = getElSalvadorDateParts();
  const endOfCurrentMonth = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(new Date(todayParts.year, todayParts.month, 0).getDate()).padStart(2, '0')}`;

  useEffect(() => {
    let isCurrentCountry = true;
    setMonthlyResolvedKeys([]);
    authenticatedApiFetch(`/api/cartera/estado-mensual?pais=${currentCountry}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success || !Array.isArray(payload.states)) {
          throw new Error('MONTHLY_STATE_UNAVAILABLE');
        }
        if (!isCurrentCountry) return;
        setMonthlyResolvedKeys(
          payload.states.map((state: any) =>
            `${state.pais}:${state.codigo_cliente}:${state.mes_periodo}`
          ),
        );
      })
      .catch(() => {
        if (isCurrentCountry) setMonthlyResolvedKeys([]);
      });
    return () => {
      isCurrentCountry = false;
    };
  }, [currentCountry]);
  const parseInvoiceAmount = (value: unknown) => {
    let normalized = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
    const comma = normalized.lastIndexOf(',');
    const period = normalized.lastIndexOf('.');
    if (comma >= 0 && period >= 0) {
      normalized = comma > period
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
    } else if (comma >= 0) {
      normalized = /\d{3}$/.test(normalized.slice(comma + 1))
        ? normalized.replace(/,/g, '')
        : normalized.replace(',', '.');
    } else if (period >= 0 && /\d{3}$/.test(normalized.slice(period + 1))) {
      normalized = normalized.replace(/\./g, '');
    }
    return Number(normalized);
  };

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

  // Purge any fake seeds from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('red_acuerdos_promesas');
      if (raw) {
        const parsed = JSON.parse(raw);
        const onlyReal = parsed.filter(
          (a: any) =>
            !a.id?.startsWith('ac-CL000002-') &&
            !a.id?.startsWith('ac-CL000003-') &&
            !a.id?.startsWith('ac-CL000007-') &&
            !a.id?.startsWith('ac-CL000019-') &&
            !a.id?.startsWith('ac-CL000030-') &&
            !a.id?.startsWith('ac-CL001757-') &&
            !a.id?.startsWith('ac-CL002028-') &&
            !a.id?.startsWith('ac-CL002568-') &&
            !a.receiptNumber?.startsWith('REC-20260')
        );
        if (onlyReal.length !== parsed.length) {
          localStorage.setItem('red_acuerdos_promesas', JSON.stringify(onlyReal));
          setAgreements(onlyReal);
        }
      }
    } catch {}
  }, []);

  // Extract actual agreements from clients' management history (gestiones reales registradas)
  const agreementsFromHistory = useMemo(() => {
    const list: PaymentAgreement[] = [];
    clients.forEach((c) => {
      if (c.country !== currentCountry) return;
      (c.managementHistory || []).forEach((h) => {
        if (h.agreement === 'Promesa de Pago' || h.agreement === 'Negociación de Cuotas') {
          list.push({
            id: h.id || `hist-${c.code}-${h.date}`,
            clientCode: c.code,
            clientName: c.name,
            country: c.country,
            agreedAmount: Number(h.committedAmount || c.totalDebt || 0),
            totalDebt: Number(c.totalDebt || 0),
            agreementDate: h.date || new Date().toISOString().split('T')[0],
            periodMonth: String(
              h.dynamicValues?.periodMonth
              || h.scheduledForDate?.slice(0, 7)
              || getRecordDateKey({ timestamp: '', date: h.date })?.slice(0, 7)
              || '',
            ),
            promiseDate: h.deadlineDate || h.date || new Date().toISOString().split('T')[0],
            promiseTime: h.promiseTime,
            contactName: h.contactName,
            status: 'Pendiente',
            installments: 1,
            agentId: c.assignedAgentId || 'agente',
            agentName: h.agentName || c.assignedAgentName || 'Agente de Cobro',
            phone: c.phone1 || c.celular,
            notes: h.observations || 'Promesa acordada en gestión telefónica.',
          });
        }
      });
    });
    return list;
  }, [clients, currentCountry]);

  // Combined real agreements list (avoiding duplicate IDs)
  const allRealAgreements = useMemo(() => {
    const map = new Map<string, PaymentAgreement>();
    agreements.forEach((a) => {
      if (a.country === currentCountry) {
        const periodMonth = a.periodMonth || a.agreementDate?.slice(0, 7);
        map.set(a.id, {
          ...a,
          periodMonth,
          status: monthlyResolvedKeys.includes(`${a.country}:${a.clientCode}:${periodMonth}`)
            ? 'Cumplido'
            : a.status,
        });
      }
    });
    agreementsFromHistory.forEach((a) => {
      if (!map.has(a.id)) {
        const periodMonth = a.periodMonth || a.agreementDate?.slice(0, 7);
        map.set(a.id, {
          ...a,
          periodMonth,
          status: monthlyResolvedKeys.includes(`${a.country}:${a.clientCode}:${periodMonth}`)
            ? 'Cumplido'
            : a.status,
        });
      }
    });
    return Array.from(map.values());
  }, [agreements, agreementsFromHistory, currentCountry, monthlyResolvedKeys]);

  // Save agreements to localStorage whenever updated
  const saveAgreements = (updated: PaymentAgreement[]) => {
    setAgreements(updated);
    try {
      localStorage.setItem('red_acuerdos_promesas', JSON.stringify(updated));
    } catch {}
  };

  const agreementsForSelectedDate = allRealAgreements
    .filter((agreement) => agreement.promiseDate === selectedPromiseDate && agreement.status === 'Pendiente')
    .sort((a, b) => `${a.promiseTime || ''}${a.clientName}`.localeCompare(`${b.promiseTime || ''}${b.clientName}`));

  const handleValidatePromisesForDate = async () => {
    setIsValidatingPromises(true);
    setPromiseValidationResult('');
    if (agreementsForSelectedDate.length === 0) {
      setPromiseValidationResult('No hay promesas pendientes para esta fecha.');
      setIsValidatingPromises(false);
      return;
    }

    const checks = await Promise.all(agreementsForSelectedDate.map(async (agreement) => {
      try {
        const response = await fetch(
          `/api/cliente360?cliente=${encodeURIComponent(agreement.clientCode)}&pais=${agreement.country}&refresh=1`
        );
        if (!response.ok) return { agreement, outcome: 'unknown' as const, outstanding: [] as string[] };
        const payload = await response.json();
        const invoices = payload?.success && Array.isArray(payload?.data?.invoices) ? payload.data.invoices : [];
        if (!invoices.length) return { agreement, outcome: 'unknown' as const, outstanding: [] as string[] };

        const outstanding = invoices.filter((invoice: any) => {
          const status = String(invoice.estado || '').trim().toUpperCase();
          if (status === 'PAGADO' || status === 'PAID') return false;
          if (status === 'PAGO PARCIAL' || status.includes('PARCIAL')) {
            const total = parseInvoiceAmount(invoice.valordoc);
            const paid = parseInvoiceAmount(invoice.pago);
            return !Number.isFinite(total) || !Number.isFinite(paid) || total - paid > 0.01;
          }
          return true;
        });
        return {
          agreement,
          outcome: outstanding.length === 0 ? 'paid' as const : 'unpaid' as const,
          outstanding: outstanding.map((invoice: any) => String(invoice.numdoc || invoice.DocEntry || 'Factura pendiente')),
        };
      } catch {
        return { agreement, outcome: 'unknown' as const, outstanding: [] as string[] };
      }
    }));

    const paid = checks.filter((check) => check.outcome === 'paid').map((check) => check.agreement);
    const unpaid = checks.filter((check) => check.outcome === 'unpaid');
    const unknown = checks.filter((check) => check.outcome === 'unknown');
    setUnpaidPromises(Object.fromEntries(unpaid.map((check) => [check.agreement.id, check.outstanding])));

    const paidClientMonths = new Map<string, { country: Country; clientCode: string; month: string }>();
    paid.forEach((agreement) => {
      const month = agreement.periodMonth || agreement.agreementDate?.slice(0, 7) || '';
      if (!month) return;
      const key = `${agreement.country}:${agreement.clientCode}:${month}`;
      paidClientMonths.set(key, { country: agreement.country, clientCode: agreement.clientCode, month });
    });
    const persistedClientMonths = new Set<string>();
    await Promise.all(Array.from(paidClientMonths.entries()).map(async ([key, value]) => {
      try {
        const response = await authenticatedApiFetch('/api/cartera/estado-mensual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pais: value.country,
            codigo_cliente: value.clientCode,
            mes: value.month,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.success && payload.recovered) {
          persistedClientMonths.add(key);
        }
      } catch {}
    }));
    const persistedPaid = paid.filter((agreement) => {
      const month = agreement.periodMonth || agreement.agreementDate?.slice(0, 7) || '';
      return persistedClientMonths.has(`${agreement.country}:${agreement.clientCode}:${month}`);
    });

    if (persistedPaid.length > 0) {
      const persistedKeys = Array.from(persistedClientMonths);
      setMonthlyResolvedKeys((current) => Array.from(new Set([...current, ...persistedKeys])));
      const paidIds = new Set(persistedPaid.map((agreement) => agreement.id));
      const fulfilled = persistedPaid.map((agreement) => ({
        ...agreement,
        status: 'Cumplido' as const,
        fulfilledDate: todayKey,
        notes: `${agreement.notes || ''}${agreement.notes ? ' | ' : ''}Verificado con SAP/SAN el ${todayKey}.`,
      }));
      saveAgreements([
        ...agreements.filter((agreement) => !paidIds.has(agreement.id)),
        ...fulfilled,
      ]);
    }

    const parts = [
      persistedPaid.length ? `${persistedPaid.length} promesa(s) cumplida(s); cartera mensual resuelta.` : '',
      paid.length > persistedPaid.length
        ? `${paid.length - persistedPaid.length} cliente(s) tienen pagos detectados, pero no se pudo guardar su estado mensual; revisa la tabla y el endpoint.`
        : '',
      unpaid.length ? `${unpaid.length} cliente(s) aún tienen facturas pendientes.` : '',
      unknown.length ? `${unknown.length} cliente(s) sin datos verificables; no se cambió su estado.` : '',
    ].filter(Boolean);
    setPromiseValidationResult(parts.join(' '));
    setIsValidatingPromises(false);
  };

  const filteredAgreements = useMemo(() => {
    return allRealAgreements.filter((a) => {
      if (statusFilter !== 'TODOS' && a.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchCode = (a.clientCode || '').toLowerCase().includes(q);
        const matchName = (a.clientName || '').toLowerCase().includes(q);
        const matchAgent = (a.agentName || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchAgent) return false;
      }
      return true;
    });
  }, [allRealAgreements, statusFilter, searchTerm]);

  // Financial KPIs from REAL agreements
  const totalAgreed = allRealAgreements.reduce((sum, a) => sum + (Number(a.agreedAmount) || 0), 0);
  const fulfilledAgreements = allRealAgreements.filter((a) => a.status === 'Cumplido');
  const fulfilledAmount = fulfilledAgreements.reduce((sum, a) => sum + (Number(a.agreedAmount) || 0), 0);
  const pendingAgreements = allRealAgreements.filter((a) => a.status === 'Pendiente');
  const pendingAmount = pendingAgreements.reduce((sum, a) => sum + (Number(a.agreedAmount) || 0), 0);
  const expiredAgreements = allRealAgreements.filter((a) => a.status === 'Vencido');
  const fulfillmentRate = totalAgreed > 0 ? ((fulfilledAmount / totalAgreed) * 100).toFixed(1) : '0.0';

  const handleCreateAgreement = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSearch = newClientCode.trim().toLowerCase();
    const client = clients.find(
      (c) =>
        (c.code || '').toLowerCase() === cleanSearch ||
        (c.name || '').toLowerCase().includes(cleanSearch)
    );

    if (!client) {
      alert(`No se encontró ningún cliente activo con el código o nombre "${newClientCode}" en ${currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'}.`);
      return;
    }

    const amt = Number(newAgreedAmount);
    if (!amt || amt <= 0) {
      alert('Ingresa un monto válido mayor a $0.');
      return;
    }

    const assignedAg = agents.find((a) => a.id === client.assignedAgentId) || currentAgent || agents[0];

    const newAgreement: PaymentAgreement = {
      id: `ac-${Date.now()}`,
      clientCode: client.code,
      clientName: client.name,
      country: client.country,
      agreedAmount: amt,
      totalDebt: Number(client.totalDebt) || amt,
      agreementDate: todayKey,
      periodMonth: todayKey.slice(0, 7),
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

    const updated = allRealAgreements.map((a) => {
      if (a.id === selectedAgreementForFulfill.id) {
        return {
          ...a,
          status: 'Cumplido' as const,
          receiptNumber: receiptNumber.trim() || `REC-${Date.now().toString().slice(-6)}`,
          fulfilledDate: todayKey,
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

  const handleOpenClientGestion = (clientCode: string) => {
    const client = clients.find((c) => c.code === clientCode);
    if (client && onOpenGestionModal) {
      onOpenGestionModal(client);
    }
  };

  const handleExportExcel = () => {
    if (allRealAgreements.length === 0) {
      alert('No hay acuerdos reales registrados para exportar.');
      return;
    }

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
    XLSX.utils.book_append_sheet(wb, ws, 'Acuerdos Reales');
    XLSX.writeFile(wb, `Acuerdos_Reales_${currentCountry}_${new Date().toISOString().split('T')[0]}.xlsx`);
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
            Supervisa las promesas de pago reales pactadas durante las gestiones de cobro. Registra pagos verificados con número de recibo bancario y controla plazos de vencimiento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {allRealAgreements.length > 0 && (
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Exportar Excel</span>
            </button>
          )}

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
            {allRealAgreements.length} compromisos registrados
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
            {fulfilledAgreements.length} acuerdos pagados ({fulfillmentRate}% efectividad)
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
            Requieren llamada de renegociación
          </div>
        </div>
      </div>

      {/* One agreements table with date validation controls */}
      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="relative w-full xl:max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por cliente, código o gestor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl glass-input text-white placeholder:text-slate-500"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto w-full xl:w-auto">
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

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <p className="text-[11px] text-slate-400">
            Valida contra SAP/SAN las promesas pendientes de la fecha elegida.
            <span className="ml-1 text-slate-300">{agreementsForSelectedDate.length} pendientes</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={selectedPromiseDate}
              onChange={(event) => {
                setSelectedPromiseDate(event.target.value);
                setPromiseValidationResult('');
                setUnpaidPromises({});
              }}
              className="px-3 py-2 rounded-xl glass-input text-xs font-mono"
              aria-label="Fecha de las promesas"
            />
            <button
              type="button"
              onClick={handleValidatePromisesForDate}
              disabled={isValidatingPromises || agreementsForSelectedDate.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isValidatingPromises ? 'Consultando facturas…' : 'Validar promesas'}
            </button>
          </div>
        </div>

        {promiseValidationResult && (
          <div className="rounded-xl border border-blue-700/40 bg-blue-950/30 px-3 py-2 text-xs text-blue-200" role="status">
            {promiseValidationResult}
          </div>
        )}
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
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 text-slate-500 flex items-center justify-center mx-auto">
                        <CircleDollarSign className="w-6 h-6" />
                      </div>
                      <div className="text-sm font-bold text-slate-300">
                        No hay acuerdos ni promesas de pago registrados aún
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Los acuerdos aparecerán aquí en tiempo real cuando un agente cierre una promesa de pago durante una llamada en la bitácora o cuando se cree manualmente con el botón <strong>"+ Registrar Nuevo Acuerdo"</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsNewAgreementModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 text-xs font-semibold hover:bg-emerald-600/30 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Registrar un acuerdo ahora</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAgreements.map((agr) => {
                  return (
                    <tr key={agr.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-blue-400">
                        {agr.clientCode}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white truncate max-w-xs">{agr.clientName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Deuda total: ${Number(agr.totalDebt || 0).toLocaleString()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-300 tabular-nums">
                        {currentCountry === 'SV' ? '$' : 'Q'}{Number(agr.agreedAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                        {unpaidPromises[agr.id] && (
                          <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                            <p className="text-[11px] text-amber-200">
                              Facturas pendientes: {unpaidPromises[agr.id].join(', ')}. Programa seguimiento.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <input
                                type="date"
                                value={followUpDates[agr.id] || ''}
                                min={todayKey}
                                max={endOfCurrentMonth}
                                onChange={(event) => setFollowUpDates((previous) => ({
                                  ...previous,
                                  [agr.id]: event.target.value,
                                }))}
                                className="min-w-0 px-2 py-1.5 rounded-lg glass-input text-[11px] font-mono"
                                aria-label={`Fecha de seguimiento para ${agr.clientCode}`}
                              />
                              <button
                                type="button"
                                disabled={!followUpDates[agr.id]}
                                onClick={() => {
                                  const date = followUpDates[agr.id];
                                  if (!date || !onScheduleFollowUp) return;
                                  onScheduleFollowUp(agr.clientCode, date, 'Segunda llamada de seguimiento');
                                  setPromiseValidationResult(`Segunda llamada programada para ${agr.clientCode} el ${date}.`);
                                }}
                                className="rounded-lg border border-amber-500/40 bg-amber-600/20 px-2 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-600/30 disabled:opacity-40"
                              >
                                Programar seguimiento
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {false && agr.status !== 'Cumplido' && (
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

                          <button
                            onClick={() => setInspectedAgreement(agr)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                            title="Ver detalle del acuerdo"
                          >
                            <Info className="w-3.5 h-3.5 text-blue-400" />
                          </button>
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

      {/* Modal Detalle de Acuerdo Inspected */}
      {inspectedAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl glass-panel border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-400" />
                Detalle del Compromiso de Pago
              </h3>
              <button
                onClick={() => setInspectedAgreement(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Cliente</div>
                <div className="text-sm font-bold text-white">{inspectedAgreement.clientName}</div>
                <div className="text-[11px] text-blue-400 font-mono">Código: {inspectedAgreement.clientCode}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Monto Pactado</div>
                  <div className="text-base font-black font-mono text-emerald-400 mt-0.5">
                    {currentCountry === 'SV' ? '$' : 'Q'}{Number(inspectedAgreement.agreedAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Fecha Prometida</div>
                  <div className="text-sm font-mono font-bold text-white mt-1">
                    {inspectedAgreement.promiseDate}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Estado</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      inspectedAgreement.status === 'Cumplido'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : inspectedAgreement.status === 'Vencido'
                        ? 'bg-red-950 text-red-300 border border-red-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}
                  >
                    {inspectedAgreement.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 pt-1">
                  Gestor responsable: <strong>{inspectedAgreement.agentName}</strong>
                </div>
                {inspectedAgreement.receiptNumber && (
                  <div className="text-[11px] text-emerald-400 font-mono font-semibold">
                    Comprobante: {inspectedAgreement.receiptNumber} (Pagado el {inspectedAgreement.fulfilledDate})
                  </div>
                )}
                {inspectedAgreement.notes && (
                  <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800 mt-2">
                    Notas: {inspectedAgreement.notes}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  const code = inspectedAgreement.clientCode;
                  setInspectedAgreement(null);
                  handleOpenClientGestion(code);
                }}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-blue-300 bg-blue-950/60 hover:bg-blue-900/80 border border-blue-800/80 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir Bitácora Completa</span>
              </button>

              <button
                type="button"
                onClick={() => setInspectedAgreement(null)}
                className="py-2 px-4 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar Nuevo Acuerdo */}
      {isNewAgreementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl glass-panel border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <CircleDollarSign className="w-5 h-5 text-emerald-400" />
                Registrar Compromiso de Pago Real
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
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Debe coincidir con un cliente activo en la cartera SAP.
                </span>
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
                Cód: <span className="text-blue-400">{selectedAgreementForFulfill.clientCode}</span> · Monto: <span className="text-emerald-400 font-bold">${Number(selectedAgreementForFulfill.agreedAmount || 0).toLocaleString()}</span>
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
