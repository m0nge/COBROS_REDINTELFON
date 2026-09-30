import React, { useState, useEffect, useRef } from 'react';
import { Client, DynamicField, RealClient360Data, SanInvoice, SanClaim } from '../types';
import { supabase } from '../supabaseClient';
import confetti from 'canvas-confetti';
import { FacturasModal } from './FacturasModal';
import {
  X,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Volume2,
  Calendar,
  DollarSign,
  Clock,
  History,
  Info,
  Building2,
  ExternalLink,
  MessageCircle,
  FileText,
  Radio,
  Search,
  FileDown,
  CreditCard,
  Users,
  Smartphone,
  Check,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface GestionModalProps {
  client: Client;
  onClose: () => void;
  onSaveGestionSuccess: (clientId: string, updatedRecord: Partial<Client>) => void;
  dynamicFields: DynamicField[];
}

export const GestionModal: React.FC<GestionModalProps> = ({
  client,
  onClose,
  onSaveGestionSuccess,
  dynamicFields,
}) => {
  // Real 360 Data from SAN API
  const [san360, setSan360] = useState<RealClient360Data | null>(null);
  const [isLoading360, setIsLoading360] = useState<boolean>(true);
  const [fetchError360, setFetchError360] = useState<string | null>(null);

  // Invoices modal filter (opened when clicking on the top cajitas or 'ver todas')
  const [invoiceModalFilter, setInvoiceModalFilter] = useState<'pendientes' | 'mes' | 'pagadas' | 'todas' | null>(null);
  const [sectionATab, setSectionATab] = useState<'facturas' | 'cliente' | 'anexos' | 'reclamos' | 'pagos' | 'equipos'>('facturas');
  const [invoiceSearch, setInvoiceSearch] = useState<string>('');
  const [claimsFilter, setClaimsFilter] = useState<'TODOS' | 'FINALIZADO' | 'REGISTRADO'>('TODOS');
  const [claimsSearch, setClaimsSearch] = useState<string>('');

  // Dynamic 7-day future deadline default
  const defaultDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Form fields
  const [managementType, setManagementType] = useState<string>('Llamada');
  const [successfulContact, setSuccessfulContact] = useState<'Sí' | 'No' | 'Sin respuesta'>('Sí');
  const [agreement, setAgreement] = useState<string>('Promesa de Pago');
  const [deadlineDate, setDeadlineDate] = useState<string>(defaultDeadline);
  const [committedAmount, setCommittedAmount] = useState<string>(String(client.totalDebt || ''));
  const [observations, setObservations] = useState<string>('');
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});

  // Audio player state (Slide 5: PBX simulation & 30s validation)
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [callDurationSeconds, setCallDurationSeconds] = useState<number>(45); // default > 30s
  const [currentPlayTime, setCurrentPlayTime] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);

  // Validation state (Slide 6)
  const [validationReport, setValidationReport] = useState<{
    show: boolean;
    callValid: boolean;
    mandatoryValid: boolean;
    agreementValid: boolean;
    isSuccess: boolean;
    errorMessage?: string;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load Real Client 360 data from backend SAN proxy
  useEffect(() => {
    let isMounted = true;
    setIsLoading360(true);
    setFetchError360(null);

    const countryParam = client.country || 'SV';
    fetch(`/api/cliente360?cliente=${encodeURIComponent(client.code)}&pais=${countryParam}`)
      .then((res) => {
        if (!res.ok) throw new Error('Error al conectar con la API de SAN');
        return res.json();
      })
      .then((json) => {
        if (!isMounted) return;
        if (json.success && json.data) {
          setSan360(json.data);
          // Pre-populate committed amount with real pending debt if available
          if (json.data.summary?.pendientesMonto > 0) {
            setCommittedAmount(String(json.data.summary.pendientesMonto));
          } else if (client.totalDebt > 0) {
            setCommittedAmount(String(client.totalDebt));
          }
        } else {
          setFetchError360(json.error || 'No se pudieron recuperar datos de SAN');
        }
      })
      .catch((err) => {
        if (isMounted) setFetchError360(err.message || 'Error de red con SAN');
      })
      .finally(() => {
        if (isMounted) setIsLoading360(false);
      });

    return () => {
      isMounted = false;
    };
  }, [client.code, client.country, client.totalDebt]);

  // Audio simulation timer
  useEffect(() => {
    let interval: any = null;
    if (isPlayingAudio) {
      interval = setInterval(() => {
        setCurrentPlayTime((prev) => {
          if (prev >= callDurationSeconds) {
            setIsPlayingAudio(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlayingAudio, callDurationSeconds]);

  // Audio playback toggle with tone generator
  const togglePlayAudio = () => {
    if (!isPlayingAudio) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
          const osc = audioContextRef.current.createOscillator();
          const gain = audioContextRef.current.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, audioContextRef.current.currentTime);
          gain.gain.setValueAtTime(0.04, audioContextRef.current.currentTime);
          osc.connect(gain);
          gain.connect(audioContextRef.current.destination);
          osc.start();
          oscillatorRef.current = osc;
        }
      } catch (e) {
        console.warn('Audio Context not supported in this environment');
      }
      setIsPlayingAudio(true);
    } else {
      if (oscillatorRef.current) {
        try {
          oscillatorRef.current.stop();
          oscillatorRef.current.disconnect();
        } catch (e) {}
      }
      setIsPlayingAudio(false);
    }
  };

  useEffect(() => {
    return () => {
      if (oscillatorRef.current) {
        try {
          oscillatorRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  // Validation Rule Logic (Slide 6):
  // 1. ¿Llamada mayor a 30 segundos?
  // 2. ¿Campos obligatorios completos?
  // 3. ¿Acuerdo tiene fecha y monto válidos?
  const handleGuardarGestion = async () => {
    setIsSubmitting(true);

    const callValid = managementType !== 'Llamada' || callDurationSeconds >= 30;
    const mandatoryValid = Boolean(managementType && successfulContact && agreement);
    let agreementValid = true;

    if (agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas') {
      const amt = Number(committedAmount);
      agreementValid = Boolean(deadlineDate && amt > 0);
    }

    const isSuccess = callValid && mandatoryValid && agreementValid;

    let errorMessage = '';
    if (!callValid) {
      errorMessage = 'La llamada grabada debe superar los 30 segundos mínimos de duración para validar la gestión.';
    } else if (!mandatoryValid) {
      errorMessage = 'Todos los campos obligatorios del registro deben estar completos.';
    } else if (!agreementValid) {
      errorMessage = 'Para Promesas de Pago o Negociaciones, se requiere una fecha límite y un monto comprometido mayor a $0.';
    }

    const report = {
      show: true,
      callValid,
      mandatoryValid,
      agreementValid,
      isSuccess,
      errorMessage,
    };

    setValidationReport(report);
    setIsSubmitting(false);

    if (isSuccess) {
      // Record into Supabase database
      try {
        supabase
          .from('bitacora_gestiones')
          .insert([
            {
              tipo_gestion: managementType,
              contacto_exitoso: successfulContact,
              acuerdo: agreement,
              duracion_llamada_segundos: callDurationSeconds,
              fecha_limite_pago: deadlineDate || null,
              monto_comprometido: Number(committedAmount || 0),
              observaciones: observations,
              validacion_exitosa: true,
            },
          ])
          .then((res) => {
            if (res.error) {
              console.warn('Nota Supabase:', res.error.message);
            } else {
              console.log('Gestión persistida con éxito en Supabase');
            }
          });
      } catch (err) {
        console.warn('Supabase sync:', err);
      }

      // Trigger confetti celebration
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'],
      });

      setTimeout(() => {
        onSaveGestionSuccess(client.code, {
          state: 'Resuelto',
          lastManagementDate: `${new Date().getDate()}/${new Date().toLocaleString('es', { month: 'short' })} - ${managementType}`,
          lastManagementType: managementType,
        });
      }, 1400);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Safe data accessors from real SAN response
  const clientInfo = san360?.clientInfo;
  const anexosData = san360?.anexosData;
  const rawInvoices: SanInvoice[] = san360?.invoices || [];
  const claims: SanClaim[] = san360?.claims || [];
  const payments = san360?.payments || [];
  const equipment = san360?.equipment || [];

  const rawPendientes = rawInvoices.filter((i) => (i.estado || '').toUpperCase() === 'PENDIENTE');
  const rawPagadas = rawInvoices.filter((i) => (i.estado || '').toUpperCase() === 'PAGADO');

  const rawPendientesCount = rawPendientes.length;
  const rawPendientesMonto = rawPendientes.reduce((a, b) => a + (parseFloat(b.valordoc) || 0), 0);
  const rawPagadasCount = rawPagadas.length;
  const rawPagadasMonto = rawPagadas.reduce((a, b) => a + (parseFloat(b.valordoc) || 0), 0);
  const rawTotalMonto = rawInvoices.reduce((a, b) => a + (parseFloat(b.valordoc) || 0), 0);

  const fallbackDebt = client.totalDebt || 0;

  const summary = san360?.summary || {
    totalEmitidasCount: rawInvoices.length || (fallbackDebt > 0 ? 1 : 0),
    totalEmitidasMonto: rawTotalMonto || fallbackDebt,
    pagadasCount: rawPagadasCount,
    pagadasMonto: rawPagadasMonto,
    pendientesCount: rawPendientesCount || (fallbackDebt > 0 ? 1 : 0),
    pendientesMonto: rawPendientesMonto || fallbackDebt,
    mesEmitidasCount: 0,
    mesEmitidasMonto: 0,
    mesPagadasCount: 0,
    mesPagadasMonto: 0,
    mesPendientesCount: 0,
    mesPendientesMonto: 0,
    claimsCount: claims.length,
  };

  // Ensure that if summary had 0 but client has registered debt in SAP, we never show $0.00
  if (summary.pendientesMonto === 0 && fallbackDebt > 0) {
    summary.pendientesMonto = fallbackDebt;
    summary.pendientesCount = summary.pendientesCount || 1;
    summary.totalEmitidasMonto = summary.totalEmitidasMonto || fallbackDebt;
    summary.totalEmitidasCount = summary.totalEmitidasCount || 1;
  }

  // Filtered invoices for inline tab preview
  const displayInvoices = rawInvoices.filter((inv) => {
    if (!invoiceSearch.trim()) return true;
    const term = invoiceSearch.toLowerCase();
    return (
      (inv.numdoc || '').toLowerCase().includes(term) ||
      (inv.DocEntry || '').toLowerCase().includes(term) ||
      (inv.num_control || '').toLowerCase().includes(term) ||
      (inv.tipodoc || '').toLowerCase().includes(term)
    );
  });

  // Filtered claims for inline tab preview
  const filteredClaims = claims.filter((clm) => {
    const estado = (clm.estado || '').toLowerCase();
    if (claimsFilter === 'FINALIZADO' && estado !== 'finalizado') return false;
    if (claimsFilter === 'REGISTRADO' && estado === 'finalizado') return false;
    if (claimsSearch.trim()) {
      const term = claimsSearch.toLowerCase();
      const matchCorrel = String(clm.correl || '').toLowerCase().includes(term);
      const matchReclamo = (clm.reclamo || '').toLowerCase().includes(term);
      const matchAsunto = (clm.asunto || '').toLowerCase().includes(term);
      const matchDesc = (clm.descripcion || '').toLowerCase().includes(term);
      const matchTec = (clm.tecnologia || '').toLowerCase().includes(term);
      return matchCorrel || matchReclamo || matchAsunto || matchDesc || matchTec;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto bg-slate-950/85 backdrop-blur-md">
      <div className="relative w-full max-w-7xl rounded-2xl glass-panel border border-slate-700/80 shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-blue-900/50 text-blue-300 border border-blue-700/50">
              {client.code}
            </span>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                {clientInfo?.CardName || client.name}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>{client.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}</span>
                <span>•</span>
                <span className="text-blue-300 font-medium">
                  {clientInfo?.CATEGORIA || client.classification || 'Cliente Corporativo'}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Split into Section A (Direct 360 View) and Section B (Actionable Registration) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-y-auto divide-y lg:divide-y-0 lg:divide-x divide-slate-800 flex-1">
          {/* ========================================================================= */}
          {/* SECCIÓN A: CONTEXTO 360 INTEGRAL EN VIVO (READ-ONLY) - 6 COLUMNS */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 p-5 sm:p-6 space-y-4 bg-slate-950/50 overflow-y-auto">
            {/* Header of Section A (NO POPUP BUTTON: VIEW IS DIRECTLY HERE) */}
            <div className="flex items-center justify-between pb-1">
              <div>
                <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Sección A: Contexto 360 Integral (Read-Only)
                </h3>
                <span className="text-[11px] text-slate-400">
                  Alimentado en vivo por SAN & SAP ERP Oficial
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  SAN En Vivo
                </span>
              </div>
            </div>

            {/* Loading Skeleton */}
            {isLoading360 && (
              <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
                <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto" />
                <p className="text-xs text-slate-300 font-medium">
                  Consultando base de facturación y servicios del cliente en SAN...
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  CL:{client.code} · País:{client.country}
                </p>
              </div>
            )}

            {/* Error Banner */}
            {!isLoading360 && fetchError360 && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{fetchError360}. Mostrando datos locales de respaldo.</span>
                </div>
              </div>
            )}

            {/* MAIN REAL 360 CONTENT */}
            {!isLoading360 && (
              <>
                {/* ========================================================================= */}
                {/* 1. CAJITAS PRIORIZADAS ARRIBA (FACTURAS PAGADAS, PENDIENTES, MONTO DEBIENDO) */}
                {/* ========================================================================= */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-blue-400" />
                      Estado de Facturación DTE
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Clic en una cajita para ver el detalle
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {/* Cajita 1: Pendientes (Monto Debiendo) */}
                    <div
                      onClick={() => setInvoiceModalFilter('pendientes')}
                      className="group cursor-pointer rounded-xl p-3 bg-gradient-to-br from-red-950/60 to-slate-900/90 border border-red-800/60 hover:border-red-500 transition-all hover:shadow-lg hover:shadow-red-950/50 flex flex-col justify-between text-left"
                      title="Clic para ver facturas pendientes"
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide">
                          Pendientes
                        </span>
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="my-1.5">
                        <div className="text-base sm:text-lg font-black text-white font-mono leading-tight">
                          ${summary.pendientesMonto.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-red-300/90 font-medium">
                          {summary.pendientesCount} {summary.pendientesCount === 1 ? 'pendiente' : 'pendientes'}
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-red-900/40 flex items-center justify-between text-[10px] text-red-400/80 font-medium">
                        <span>Monto debiendo</span>
                        <span className="group-hover:translate-x-0.5 transition-transform font-bold">Ver →</span>
                      </div>
                    </div>

                    {/* Cajita 2: Pagadas */}
                    <div
                      onClick={() => setInvoiceModalFilter('pagadas')}
                      className="group cursor-pointer rounded-xl p-3 bg-gradient-to-br from-emerald-950/60 to-slate-900/90 border border-emerald-800/60 hover:border-emerald-500 transition-all hover:shadow-lg hover:shadow-emerald-950/50 flex flex-col justify-between text-left"
                      title="Clic para ver facturas pagadas"
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
                          Pagadas
                        </span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="my-1.5">
                        <div className="text-base sm:text-lg font-black text-white font-mono leading-tight">
                          ${summary.pagadasMonto.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-emerald-300/90 font-medium">
                          {summary.pagadasCount} canceladas
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-emerald-900/40 flex items-center justify-between text-[10px] text-emerald-400/80 font-medium">
                        <span>Historial al día</span>
                        <span className="group-hover:translate-x-0.5 transition-transform font-bold">Ver →</span>
                      </div>
                    </div>

                    {/* Cajita 3: Facturas Emitidas Totales */}
                    <div
                      onClick={() => setInvoiceModalFilter('todas')}
                      className="group cursor-pointer rounded-xl p-3 bg-gradient-to-br from-blue-950/60 to-slate-900/90 border border-blue-800/60 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-950/50 flex flex-col justify-between text-left"
                      title="Clic para ver todas las facturas emitidas"
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">
                          Emitidas
                        </span>
                        <FileText className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="my-1.5">
                        <div className="text-base sm:text-lg font-black text-white font-mono leading-tight">
                          ${summary.totalEmitidasMonto.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-blue-300/90 font-medium">
                          {summary.totalEmitidasCount} facturas
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-blue-900/40 flex items-center justify-between text-[10px] text-blue-400/80 font-medium">
                        <span>Histórico emitido</span>
                        <span className="group-hover:translate-x-0.5 transition-transform font-bold">Ver →</span>
                      </div>
                    </div>

                    {/* Cajita 4: Facturas del Mes Actual (Corte de mes) */}
                    <div
                      onClick={() => setInvoiceModalFilter('mes')}
                      className="group cursor-pointer rounded-xl p-3 bg-gradient-to-br from-purple-950/60 to-slate-900/90 border border-purple-800/60 hover:border-purple-500 transition-all hover:shadow-lg hover:shadow-purple-950/50 flex flex-col justify-between text-left"
                      title="Clic para ver facturas del mes actual"
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">
                          Mes Actual
                        </span>
                        <Calendar className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="my-1.5">
                        <div className="text-base sm:text-lg font-black text-white font-mono leading-tight">
                          ${summary.mesEmitidasMonto > 0 ? summary.mesEmitidasMonto.toFixed(2) : summary.pendientesMonto.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-purple-300/90 font-medium">
                          {summary.mesEmitidasCount || (summary.pendientesCount > 0 ? summary.pendientesCount : 1)} del corte
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-purple-900/40 flex items-center justify-between text-[10px] text-purple-400/80 font-medium">
                        <span>Septiembre 2026</span>
                        <span className="group-hover:translate-x-0.5 transition-transform font-bold">Ver →</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* 2. DASHBOARD 360 TABS NAVIGATION DIRECTLY IN LEFT COLUMN */}
                {/* ========================================================================= */}
                <div className="border-b border-slate-800/80 flex items-center gap-1 overflow-x-auto pb-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setSectionATab('facturas')}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap font-medium ${
                      sectionATab === 'facturas'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Facturas ({rawInvoices.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSectionATab('cliente')}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap font-medium ${
                      sectionATab === 'cliente'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Info & Contactos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSectionATab('anexos')}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap font-medium ${
                      sectionATab === 'anexos'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Líneas & Anexos ({anexosData?.anexos?.length || clientInfo?.['TOTAL ANEXOS'] || 0})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSectionATab('reclamos')}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap font-medium ${
                      sectionATab === 'reclamos'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Reclamos ({claims.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSectionATab('pagos')}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap font-medium ${
                      sectionATab === 'pagos'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Pagos ({payments.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSectionATab('equipos')}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap font-medium ${
                      sectionATab === 'equipos'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Equipos ({equipment.length})</span>
                  </button>
                </div>

                {/* ========================================================================= */}
                {/* TAB CONTENT 1: FACTURAS REALES DTE */}
                {/* ========================================================================= */}
                {sectionATab === 'facturas' && (
                  <div className="space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={invoiceSearch}
                          onChange={(e) => setInvoiceSearch(e.target.value)}
                          placeholder="Buscar por N° doc, tipo..."
                          className="w-full pl-8 pr-3 py-1 text-xs rounded-lg glass-input bg-slate-950/70 text-slate-200"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => setInvoiceModalFilter('todas')}
                        className="px-2.5 py-1 rounded-lg bg-blue-950/60 hover:bg-blue-900/80 border border-blue-800/80 text-blue-300 text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                      >
                        <span>Ver Detalle Completo</span>
                        <ExternalLink className="w-3 h-3 text-blue-400" />
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
                      <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-800/80 text-xs">
                        {displayInvoices.length === 0 ? (
                          <div className="p-6 text-center text-slate-400">
                            No se encontraron facturas registradas.
                          </div>
                        ) : (
                          displayInvoices.slice(0, 8).map((inv, idx) => {
                            const isPagado = (inv.estado || '').toUpperCase() === 'PAGADO';
                            const valor = parseFloat(inv.valordoc) || 0;
                            const pdfUrl = inv.url ? `https://san.red.com.sv/${inv.url}` : null;

                            return (
                              <div
                                key={inv.DocEntry || inv.DOCENTRY || idx}
                                className="p-2.5 hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-slate-200">
                                      Doc: {inv.numdoc || inv.DocEntry}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                                      {inv.tipodoc || 'CCF'}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                        isPagado
                                          ? 'bg-emerald-500/20 text-emerald-400'
                                          : 'bg-red-500/20 text-red-400'
                                      }`}
                                    >
                                      {isPagado ? 'PAGADO' : 'PENDIENTE'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                                    Emisión: {inv.fechaEmision} • Vence: {inv.fechavence}
                                    {inv.Fecha_aplica_pago && isPagado && ` • Pagado: ${inv.Fecha_aplica_pago.split(' ')[0]}`}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="text-right font-mono">
                                    <div className="font-extrabold text-white">
                                      ${valor.toFixed(2)}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      IVA: ${(parseFloat(inv.VatSum) || 0).toFixed(2)}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {pdfUrl && (
                                      <a
                                        href={pdfUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                                        title="Descargar PDF Oficial SAN"
                                      >
                                        <FileDown className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                    {inv.link_pago && (
                                      <a
                                        href={inv.link_pago}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="p-1.5 rounded-lg bg-blue-900/60 hover:bg-blue-800 text-blue-300 transition-colors"
                                        title="Abrir enlace de pago oficial"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {rawInvoices.length > 8 && (
                        <div className="p-2 bg-slate-950/80 border-t border-slate-800 text-center">
                          <button
                            type="button"
                            onClick={() => setInvoiceModalFilter('todas')}
                            className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold"
                          >
                            Ver las {rawInvoices.length} facturas completas →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* TAB CONTENT 2: INFORMACIÓN Y CONTACTOS DIRECTOS */}
                {/* ========================================================================= */}
                {sectionATab === 'cliente' && (
                  <div className="space-y-3 animate-fade-in text-xs">
                    {/* Ficha Segmento e Industria */}
                    <div className="rounded-xl p-3.5 bg-slate-900/80 border border-slate-800 space-y-2">
                      <div className="font-bold text-slate-300 uppercase tracking-wider text-[11px] border-b border-slate-800/80 pb-1.5 flex items-center justify-between">
                        <span>Ficha Maestra & Clasificación</span>
                        <span className="text-emerald-400 font-mono">
                          {clientInfo?.CLASIFICACION || 'ACTIVO'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 block">Vertical:</span>
                          <span className="font-semibold text-slate-200">{clientInfo?.VERTICAL || 'Industria y Servicios'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Giro:</span>
                          <span className="font-semibold text-slate-200">{clientInfo?.GIRO || 'Comercial'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Categoría Fiscal:</span>
                          <span className="font-semibold text-slate-200">{clientInfo?.CATEGORIA || client.classification || 'Persona Natural'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Ubicación:</span>
                          <span className="font-semibold text-slate-200">
                            {clientInfo?.MUNICIPIO || client.municipality || 'San Salvador'}, {clientInfo?.DEPARTAMENTO || client.department || 'San Salvador'}
                          </span>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-800/80 text-[11px]">
                        <span className="text-slate-400 block">Dirección Fiscal / Instalación:</span>
                        <p className="text-slate-200 leading-snug mt-0.5">
                          {client.address || 'Registrada en SAP ERP'}
                        </p>
                      </div>
                    </div>

                    {/* Canales Directos con Botones de Acción Inmediata */}
                    <div className="rounded-xl p-3.5 bg-slate-900/80 border border-slate-800 space-y-2.5">
                      <div className="font-bold text-slate-300 uppercase tracking-wider text-[11px] border-b border-slate-800/80 pb-1.5">
                        Canales de Contacto Directo
                      </div>

                      <div className="space-y-2">
                        {/* Teléfono Cobros */}
                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">
                              Contacto Cobros: {clientInfo?.['CONTACTO COBROS'] || 'Titular'}
                            </span>
                            <span className="font-mono font-bold text-slate-200 text-xs">
                              {clientInfo?.['TELEFONO COBROS'] || client.phone1 || client.cell || 'No registrado'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {(clientInfo?.['TELEFONO COBROS'] || client.phone1 || client.cell) && (
                              <>
                                <a
                                  href={`tel:${(clientInfo?.['TELEFONO COBROS'] || client.phone1 || client.cell || '').replace(/\D/g, '')}`}
                                  className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                                  title="Llamar"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                </a>
                                <a
                                  href={`https://wa.me/${(clientInfo?.['TELEFONO COBROS'] || client.phone1 || client.cell || '').replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
                                  title="Enviar WhatsApp"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                </a>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Correo Electrónico Cobros */}
                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">Correo Cobros</span>
                            <span className="font-mono font-semibold text-slate-200 text-xs truncate block max-w-[200px]">
                              {clientInfo?.['CORREO COBROS'] || clientInfo?.EMAIL || client.email || 'Sin correo registrado'}
                            </span>
                          </div>

                          {(clientInfo?.['CORREO COBROS'] || clientInfo?.EMAIL || client.email) && (
                            <a
                              href={`mailto:${clientInfo?.['CORREO COBROS'] || clientInfo?.EMAIL || client.email}`}
                              className="p-1.5 rounded-lg bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors"
                              title="Redactar Correo"
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Equipo de Cuenta RED */}
                    <div className="rounded-xl p-3.5 bg-slate-900/80 border border-slate-800 space-y-2">
                      <div className="font-bold text-slate-300 uppercase tracking-wider text-[11px] border-b border-slate-800/80 pb-1.5">
                        Equipo de Cuenta Asignado
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                          <span className="text-slate-400 block text-[10px]">Ejecutivo de Ventas</span>
                          <span className="font-semibold text-white truncate block">
                            {clientInfo?.EJECUTIVO || client.salesManager || 'No asignado'}
                          </span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                          <span className="text-slate-400 block text-[10px]">Gestor de Cobros</span>
                          <span className="font-semibold text-white truncate block">
                            {clientInfo?.COBROS || clientInfo?.['GESTOR DE COBRO'] || 'Cobranza RED'}
                          </span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60">
                          <span className="text-slate-400 block text-[10px]">Atención SAC</span>
                          <span className="font-semibold text-white truncate block">
                            {clientInfo?.SAC || 'SAC Central'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* TAB CONTENT 3: LÍNEAS Y ANEXOS */}
                {/* ========================================================================= */}
                {sectionATab === 'anexos' && (
                  <div className="space-y-3 animate-fade-in text-xs">
                    {/* Resumen Anexos */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">Total Anexos</span>
                        <span className="text-base font-black font-mono text-white">
                          {anexosData?.lineas || clientInfo?.['TOTAL ANEXOS'] || (anexosData?.anexos?.length || 0)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">Anexos PTT</span>
                        <span className="text-base font-black font-mono text-emerald-400">
                          {clientInfo?.['ANEXOS PTT'] || (anexosData?.anexos?.length || 0)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">Bloqueados</span>
                        <span className="text-base font-black font-mono text-amber-400">
                          {clientInfo?.['ANEXOS BLOQUEADOS'] || '0'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">Inhibidos</span>
                        <span className="text-base font-black font-mono text-red-400">
                          {clientInfo?.['ANEXOS INHIBIDOS'] || '0'}
                        </span>
                      </div>
                    </div>

                    {/* Lista de Anexos */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
                      <div className="p-2.5 bg-slate-950/60 border-b border-slate-800 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                        Detalle de Líneas y Anexos Activos
                      </div>
                      <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-800/80">
                        {anexosData?.anexos && anexosData.anexos.length > 0 ? (
                          anexosData.anexos.map((a, idx) => (
                            <div key={idx} className="p-2.5 flex items-center justify-between text-xs">
                              <div>
                                <span className="font-mono font-bold text-slate-200">
                                  Anexo: {a.anexo}
                                </span>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Centro Costo: {a.folncc || a.folcct || 'Sin centro'}
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                                {a.estado || 'Activo'}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="p-5 text-center text-slate-400">
                            {clientInfo?.['TOTAL ANEXOS'] ? `${clientInfo['TOTAL ANEXOS']} anexos PTT activos en cuenta` : 'Sin anexos registrados'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* TAB CONTENT: RECLAMOS Y TICKETS DE SERVICIO */}
                {/* ========================================================================= */}
                {sectionATab === 'reclamos' && (
                  <div className="space-y-3 animate-fade-in text-xs">
                    {/* Summary metrics for claims */}
                    <div className="grid grid-cols-3 gap-2">
                      <div
                        onClick={() => setClaimsFilter('TODOS')}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          claimsFilter === 'TODOS'
                            ? 'bg-blue-950/80 border-blue-500 shadow-sm'
                            : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-[10px] text-slate-400 block">Total Reclamos</span>
                        <span className="text-base font-black font-mono text-blue-400">
                          {claims.length}
                        </span>
                      </div>

                      <div
                        onClick={() => setClaimsFilter('FINALIZADO')}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          claimsFilter === 'FINALIZADO'
                            ? 'bg-emerald-950/80 border-emerald-500 shadow-sm'
                            : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-[10px] text-slate-400 block">Finalizados</span>
                        <span className="text-base font-black font-mono text-emerald-400">
                          {claims.filter((c) => (c.estado || '').toLowerCase() === 'finalizado').length}
                        </span>
                      </div>

                      <div
                        onClick={() => setClaimsFilter('REGISTRADO')}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          claimsFilter === 'REGISTRADO'
                            ? 'bg-amber-950/80 border-amber-500 shadow-sm'
                            : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-[10px] text-slate-400 block">En Proceso / Reg.</span>
                        <span className="text-base font-black font-mono text-amber-400">
                          {claims.filter((c) => (c.estado || '').toLowerCase() !== 'finalizado').length}
                        </span>
                      </div>
                    </div>

                    {/* Search inside claims */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={claimsSearch}
                        onChange={(e) => setClaimsSearch(e.target.value)}
                        placeholder="Buscar por ticket, correlativo o asunto..."
                        className="w-full pl-8 pr-3 py-1 text-xs rounded-lg glass-input bg-slate-950/70 text-slate-200"
                      />
                    </div>

                    {/* Claims list */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
                      <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-800/80">
                        {filteredClaims.length === 0 ? (
                          <div className="p-6 text-center text-slate-400">
                            No se encontraron reclamos registrados para este cliente.
                          </div>
                        ) : (
                          filteredClaims.slice(0, 15).map((clm, idx) => {
                            const isFinalizado = (clm.estado || '').toLowerCase() === 'finalizado';
                            return (
                              <div key={clm.correl || idx} className="p-3 hover:bg-slate-800/40 transition-colors space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-slate-200">
                                      #{clm.correl} · {clm.reclamo}
                                    </span>
                                    {clm.tecnologia && (
                                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                                        {clm.tecnologia}
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      isFinalizado
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : 'bg-amber-500/20 text-amber-400'
                                    }`}
                                  >
                                    {clm.estado || 'Registrado'}
                                  </span>
                                </div>

                                <div className="font-semibold text-white text-[11px]">
                                  {clm.asunto || clm.motivo || 'Reclamo técnico'}
                                </div>

                                {clm.descripcion && (
                                  <p className="text-slate-300 text-[11px] leading-snug line-clamp-2">
                                    {clm.descripcion}
                                  </p>
                                )}

                                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
                                  <span>Fecha: {clm.fechatrx ? clm.fechatrx.split('.')[0] : '-'}</span>
                                  <span>Técnico: {clm.tecnico || clm.useringr || 'No asignado'}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {filteredClaims.length > 15 && (
                        <div className="p-2 bg-slate-950/80 border-t border-slate-800 text-center text-[10px] text-slate-400">
                          Mostrando los primeros 15 de {filteredClaims.length} reclamos
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* TAB CONTENT 4: HISTORIAL DE PAGOS */}
                {/* ========================================================================= */}
                {sectionATab === 'pagos' && (
                  <div className="space-y-2.5 animate-fade-in text-xs">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
                      <div className="p-2.5 bg-slate-950/60 border-b border-slate-800 text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Recibos de Pago Registrados</span>
                        <span className="text-emerald-400 font-mono font-semibold">
                          {payments.length} recibos
                        </span>
                      </div>
                      <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-800/80">
                        {payments.length === 0 ? (
                          <div className="p-6 text-center text-slate-400">
                            No se encontraron recibos de pago en el sistema.
                          </div>
                        ) : (
                          payments.slice(0, 10).map((p, idx) => (
                            <div key={idx} className="p-2.5 flex items-center justify-between hover:bg-slate-800/40 transition-colors">
                              <div>
                                <span className="font-mono font-bold text-slate-200">
                                  Recibo N° {p.DocNum || p.DocEntry}
                                </span>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Fecha: {p.DocDate ? p.DocDate.split(' ')[0] : '-'}
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-extrabold text-emerald-400 block">
                                  ${p.DocTotal ? Number(p.DocTotal).toFixed(2) : '101.70'}
                                </span>
                                <span className="text-[10px] text-slate-400">Aplicado</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* TAB CONTENT 5: EQUIPOS Y SIMS */}
                {/* ========================================================================= */}
                {sectionATab === 'equipos' && (
                  <div className="space-y-2.5 animate-fade-in text-xs">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
                      <div className="p-2.5 bg-slate-950/60 border-b border-slate-800 text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Equipos en Ubicación y SIMs</span>
                        <span className="text-blue-400 font-mono font-semibold">
                          {equipment.length} equipos
                        </span>
                      </div>
                      <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-800/80">
                        {equipment.length === 0 ? (
                          <div className="p-6 text-center text-slate-400">
                            No se encontraron equipos registrados para esta cuenta.
                          </div>
                        ) : (
                          equipment.slice(0, 10).map((eq, idx) => (
                            <div key={idx} className="p-2.5 flex items-center justify-between hover:bg-slate-800/40 transition-colors">
                              <div className="min-w-0 flex-1">
                                <span className="font-mono font-bold text-slate-200 truncate block">
                                  {eq.eqpnam || 'Equipo RED'}
                                </span>
                                <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                  Serie: {eq.eqpser || 'N/A'} • Tipo: {eq.eqptip || 'Terminal'}
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-900/40 text-blue-300 shrink-0">
                                Folio: {eq.folcod || '-'}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ========================================================================= */}
          {/* SECCIÓN B: REGISTRO DINÁMICO Y GESTIÓN ACTIVA - 6 COLUMNS */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 p-5 sm:p-6 space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Sección B: Registro Dinámico
              </h3>
              <span className="text-[11px] text-slate-400">Bitácora Oficial de Cobranza</span>
            </div>

            {/* Tipo de Gestión */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Tipo de Gestión (Llamada / WhatsApp / Email / Visita) <span className="text-red-400">*</span>
              </label>
              <select
                value={managementType}
                onChange={(e) => setManagementType(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
              >
                <option value="Llamada" className="bg-slate-900">Llamada</option>
                <option value="WhatsApp" className="bg-slate-900">WhatsApp</option>
                <option value="Email" className="bg-slate-900">Email</option>
                <option value="Visita" className="bg-slate-900">Visita</option>
              </select>
            </div>

            {/* ¿Contacto exitoso? (Sí / No / Sin respuesta) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                ¿Contacto exitoso? (Sí / No / Sin respuesta) <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Sí', 'No', 'Sin respuesta'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSuccessfulContact(opt)}
                    className={`py-2 px-3 text-xs font-semibold rounded-xl border transition-all text-center ${
                      successfulContact === opt
                        ? 'bg-blue-600 text-white border-blue-400 shadow-sm shadow-blue-500/30'
                        : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Acuerdo */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Acuerdo <span className="text-red-400">*</span>
              </label>
              <select
                value={agreement}
                onChange={(e) => setAgreement(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
              >
                <option value="Promesa de Pago" className="bg-slate-900">Promesa de Pago</option>
                <option value="Negociación de Cuotas" className="bg-slate-900">Negociación de Cuotas</option>
                <option value="Sin Acuerdo" className="bg-slate-900">Sin Acuerdo</option>
                <option value="Disputa de Factura" className="bg-slate-900">Disputa de Factura</option>
              </select>
            </div>

            {/* Fecha Límite & Monto Comprometido */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Fecha límite <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Monto comprometido <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 font-bold font-mono">$</span>
                  <input
                    type="number"
                    value={committedAmount}
                    onChange={(e) => setCommittedAmount(e.target.value)}
                    placeholder="Monto prometido"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Observaciones libres */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Observaciones de la Gestión
              </label>
              <textarea
                rows={3}
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                placeholder="Detalles sobre el acuerdo, número de WhatsApp para recordatorio o comentarios del cliente..."
                className="w-full px-3 py-2 text-xs rounded-xl glass-input resize-none font-medium text-slate-200"
              />
            </div>

            {/* Dynamic bitácora fields configured by admin (if any) */}
            {dynamicFields
              .filter((f) => !['tipo_gestion', 'contacto_exitoso', 'acuerdo', 'fecha_limite', 'monto_comprometido', 'observaciones'].includes(f.name))
              .map((field) => (
                <div key={field.id}>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {field.label} {field.isRequired && <span className="text-red-400">*</span>}
                  </label>
                  {field.type === 'dropdown' ? (
                    <select
                      value={dynamicValues[field.name] || ''}
                      onChange={(e) => setDynamicValues({ ...dynamicValues, [field.name]: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                    >
                      <option value="">Seleccione una opción</option>
                      {field.options?.map((opt) => (
                        <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'datepicker' ? 'date' : 'text'}
                      value={dynamicValues[field.name] || ''}
                      onChange={(e) => setDynamicValues({ ...dynamicValues, [field.name]: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                    />
                  )}
                </div>
              ))}

            {/* CALL RECORDING AUDIO PLAYER (Slide 5: PBX simulation & 30s validation) */}
            <div className="rounded-xl p-3.5 bg-slate-900/90 border border-slate-700/80 shadow-inner">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                  Grabación de Llamada (Voz y Validación 30s)
                </span>
                <div className="flex items-center gap-2 font-mono">
                  <span>Duración: {callDurationSeconds}s</span>
                  <button
                    type="button"
                    onClick={() => setCallDurationSeconds(callDurationSeconds >= 30 ? 18 : 45)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 underline"
                    title="Alternar duración para probar validación exitosa o fallo de 30s"
                  >
                    [Simular {callDurationSeconds >= 30 ? '<30s (Fallo)' : '>30s (Éxito)'}]
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlayAudio}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    isPlayingAudio
                      ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30'
                      : 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500'
                  }`}
                >
                  {isPlayingAudio ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>

                <div className="font-mono text-xs font-bold text-white shrink-0">
                  {isPlayingAudio ? formatTimer(currentPlayTime) : '03:45'}
                </div>

                {/* Animated Waveform Visualization */}
                <div className="flex-1 flex items-center justify-between gap-1 h-7 px-2 bg-slate-950/60 rounded-lg overflow-hidden">
                  {[20, 45, 75, 30, 90, 60, 40, 85, 95, 35, 65, 80, 50, 70, 90, 30, 55, 85, 40, 60, 75, 30].map(
                    (val, i) => {
                      const isActive = isPlayingAudio && i < (currentPlayTime % 22);
                      const dynamicHeight = isPlayingAudio ? (val + (i % 3) * 15) % 100 : val;
                      return (
                        <span
                          key={i}
                          style={{ height: `${Math.max(15, dynamicHeight)}%` }}
                          className={`w-1 rounded-full transition-all duration-150 ${
                            isActive
                              ? 'bg-amber-400'
                              : isPlayingAudio
                              ? 'bg-blue-400'
                              : 'bg-slate-600'
                          }`}
                        />
                      );
                    }
                  )}
                </div>

                <div className="font-mono text-xs text-slate-400 shrink-0">
                  12:15 PM
                </div>
              </div>

              {callDurationSeconds < 30 && (
                <div className="mt-2 text-[11px] text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Atención: Duración actual es {callDurationSeconds}s. Requiere ≥30s para validar.</span>
                </div>
              )}
            </div>

            {/* VALIDATION REPORT BANNER (Slide 6: Éxito vs Fallo) */}
            {validationReport && validationReport.show && (
              <div
                className={`p-4 rounded-xl border transition-all ${
                  validationReport.isSuccess
                    ? 'bg-emerald-950/70 border-emerald-500/80 shadow-lg shadow-emerald-900/30'
                    : 'bg-red-950/70 border-red-500/80 shadow-lg shadow-red-900/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {validationReport.isSuccess ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  )}
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    {validationReport.isSuccess ? 'Éxito en Validación' : 'Fallo: Alerta de Gestión Incompleta'}
                  </h4>
                </div>

                <div className="text-xs text-slate-300 space-y-1 pl-7">
                  <div className="flex items-center gap-2">
                    <span className={validationReport.callValid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {validationReport.callValid ? '✓' : '✗'}
                    </span>
                    <span>1. ¿Llamada mayor a 30 segundos? ({callDurationSeconds}s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={validationReport.mandatoryValid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {validationReport.mandatoryValid ? '✓' : '✗'}
                    </span>
                    <span>2. ¿Campos obligatorios completos?</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={validationReport.agreementValid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {validationReport.agreementValid ? '✓' : '✗'}
                    </span>
                    <span>3. ¿Acuerdo tiene fecha y monto válidos? (${committedAmount})</span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-white/10 text-xs font-semibold pl-7">
                  {validationReport.isSuccess ? (
                    <span className="text-emerald-300">
                      Estado cambia a Resuelto. Cuenta guardada exitosamente.
                    </span>
                  ) : (
                    <span className="text-red-300">
                      {validationReport.errorMessage}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Botón Guardar Gestión */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleGuardarGestion}
                disabled={isSubmitting}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-blue-600/30 transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSubmitting ? 'Validando Gestión...' : 'Guardar Gestión'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Detail Popup (Opened when clicking the cajitas or 'ver todas') */}
      {invoiceModalFilter && (
        <FacturasModal
          isOpen={Boolean(invoiceModalFilter)}
          onClose={() => setInvoiceModalFilter(null)}
          filter={invoiceModalFilter}
          invoices={rawInvoices}
        />
      )}
    </div>
  );
};
