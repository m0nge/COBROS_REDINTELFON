import React, { useState, useEffect, useRef } from 'react';
import { Client, DynamicField, ManagementRecord } from '../types';
import { supabase } from '../supabaseClient';
import confetti from 'canvas-confetti';
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
  Wifi,
  Tv,
  Smartphone,
  Shield,
  Clock,
  History,
  Info,
  Check,
  AlertCircle,
  HelpCircle,
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
  // Form fields
  const [managementType, setManagementType] = useState<string>('Llamada');
  const [successfulContact, setSuccessfulContact] = useState<'Sí' | 'No' | 'Sin respuesta'>('Sí');
  const [agreement, setAgreement] = useState<string>('Promesa de Pago');
  const [deadlineDate, setDeadlineDate] = useState<string>('2026-11-15');
  const [committedAmount, setCommittedAmount] = useState<string>('2000');
  const [observations, setObservations] = useState<string>(
    'Cliente confirma pago completo para la fecha indicada. Se enviará recordatorio por WhatsApp.'
  );
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});
  const [live360, setLive360] = useState<any>(null);

  // Fetch client 360 data from API
  useEffect(() => {
    fetch(
      `/api/cliente360?cliente=${encodeURIComponent(client.code)}&pais=${client.country}&name=${encodeURIComponent(client.name)}&debt=${client.totalDebt}&phone=${encodeURIComponent(client.phone1 || '')}&email=${encodeURIComponent(client.email || '')}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setLive360(data.data);
        }
      })
      .catch((err) => console.warn('Could not fetch live 360:', err));
  }, [client]);

  // Audio player state
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

  // Audio playback toggle with synthetic audio tone
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-6xl rounded-2xl glass-panel border border-slate-700/80 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-md text-xs font-bold font-mono bg-blue-900/50 text-blue-300 border border-blue-700/50">
              {client.code}
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Cierre de Acuerdos · {client.name}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {client.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Split into Sección A and Sección B matching Slide 5 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-y-auto divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          {/* ========================================================================= */}
          {/* SECCIÓN A: CONTEXTO INTEGRADO (READ-ONLY) - 6 COLUMNS */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 p-6 space-y-6 bg-slate-950/40 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                <Info className="w-4 h-4" />
                Sección A: Contexto Integrado (Read-Only)
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">SAP ERP & SAN CRM</span>
            </div>

            {/* 1. SAP CARD (Slide 5: SAP, Nombre, Teléfono, Email, Total Deuda, Últimos 5 Pagos) */}
            <div className="rounded-xl p-4 bg-slate-900/70 border border-slate-800 relative">
              <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  SAP Cartera Vigente
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  Gestor: {client.salesManager || 'Gestor RED'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="space-y-1">
                  <div className="text-xs text-slate-400">Nombre del Cliente:</div>
                  <div className="text-sm font-semibold text-slate-100">{client.name}</div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>{client.phone1 || '+503 7300 1234'}</span>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Mail className="w-3 h-3 text-slate-400" />
                    <span className="truncate">{client.email || 'contacto@cliente.com'}</span>
                  </div>
                </div>

                {/* Total Deuda en Rojo Brillante como en la diapositiva */}
                <div className="flex flex-col items-end justify-center bg-red-950/20 p-3 rounded-lg border border-red-900/40">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Total Deuda:</span>
                  <span className="text-3xl font-extrabold font-mono text-red-500 tabular-nums">
                    ${client.totalDebt.toLocaleString('en-US')}
                  </span>
                  <span className="text-[11px] font-semibold text-red-400 mt-0.5">
                    {client.daysArrears} días mora acumulada
                  </span>
                </div>
              </div>

              {/* Últimos 5 Pagos */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">Últimos 5 Pagos Registrados:</div>
                <div className="space-y-1 text-xs font-mono">
                  {(live360?.sap?.lastPayments || [
                    { id: '1', date: '13/Oct', amount: 900, type: 'Parcial' },
                    { id: '2', date: '26/Sep', amount: 5000, type: 'Completo' },
                    { id: '3', date: '15/Sep', amount: 3200, type: 'Parcial' },
                    { id: '4', date: '01/Sep', amount: 3400, type: 'Completo' },
                    { id: '5', date: '18/Ago', amount: 500, type: 'Parcial' },
                  ]).map((p: any) => (
                    <div key={p.id || p.date} className="flex items-center justify-between py-1 px-2 rounded bg-slate-950/60">
                      <span className="text-slate-300">
                        {p.date}: ${Number(p.amount).toLocaleString('en-US')}
                      </span>
                      <span
                        className={`text-[11px] px-1.5 py-0.2 rounded ${
                          p.type === 'Completo'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {p.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 2. SAN CARD (Servicios Contratados + Reclamos Recientes) */}
            <div className="rounded-xl p-4 bg-slate-900/70 border border-slate-800">
              <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  SAN Operaciones y Servicios
                </span>
                <span className="text-[11px] text-slate-400">Endpoint Cliente 360</span>
              </div>

              {/* Servicios Contratados */}
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-400 mb-2">Servicios Contratados:</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <Wifi className="w-4 h-4 text-blue-400" />
                    <span className="text-slate-200">Internet Fibra</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <Tv className="w-4 h-4 text-indigo-400" />
                    <span className="text-slate-200">TV Digital</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                    <span className="text-slate-200">Telefonía Móvil</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <Shield className="w-4 h-4 text-amber-400" />
                    <span className="text-slate-200">Seguro Hogar</span>
                  </div>
                </div>
              </div>

              {/* Reclamos Recientes */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-2">Reclamos Recientes:</div>
                <div className="space-y-1.5 text-xs">
                  {(live360?.san?.recentClaims || [
                    { id: 'c-1', date: '05/Nov', issue: 'Facturación incorrecta', status: 'Pendiente' },
                    { id: 'c-2', date: '28/Oct', issue: 'Interrupción de servicio', status: 'Resuelto' },
                    { id: 'c-3', date: '12/Oct', issue: 'Equipo defectuoso', status: 'En Proceso' },
                  ]).map((claim: any) => (
                    <div key={claim.id} className="flex items-center justify-between p-2 rounded bg-slate-950/60">
                      <span className="text-slate-300">
                        {claim.date} - {claim.issue}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          claim.status === 'Resuelto'
                            ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
                            : claim.status === 'Pendiente'
                            ? 'bg-orange-950/80 text-orange-300 border-orange-800/60'
                            : 'bg-amber-950/80 text-amber-300 border-amber-800/60'
                        }`}
                      >
                        {claim.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. HISTÓRICO INTEGRADO (Slide 5: Timeline) */}
            <div className="rounded-xl p-4 bg-slate-900/70 border border-slate-800">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                Histórico Integrado de Gestiones
              </div>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-start gap-2.5">
                  <Phone className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-200">10/Nov - Llamada Saliente:</span>
                    <span className="text-slate-400 ml-1">
                      Cliente promete pago de $2,000 para el 15/Nov.
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Mail className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-200">25/Oct - Email Entrante:</span>
                    <span className="text-slate-400 ml-1">
                      Consulta sobre plan de pagos. Respondido con opciones de financiamiento.
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-200">08/Oct - Visita Técnica:</span>
                    <span className="text-slate-400 ml-1">
                      Se reemplazó router. Cliente satisfecho.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* SECCIÓN B: REGISTRO DINÁMICO - 6 COLUMNS */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 p-6 space-y-5 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Sección B: Registro Dinámico
              </h3>
              <span className="text-[11px] text-slate-400">Bitácora Configurable</span>
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
                    placeholder="2000"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Observaciones libres */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Observaciones libres
              </label>
              <textarea
                rows={3}
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                placeholder="Detalles sobre el acuerdo, número de WhatsApp para recordatorio..."
                className="w-full px-3 py-2 text-xs rounded-xl glass-input resize-none font-medium"
              />
            </div>

            {/* Additional dynamic fields configured by admin (if any) */}
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
                  ) : field.type === 'checkbox' ? (
                    <div className="space-y-1.5">
                      {field.options?.map((opt) => (
                        <label key={opt} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                            checked={Boolean(dynamicValues[field.name]?.includes(opt))}
                            onChange={(e) => {
                              const current = dynamicValues[field.name] || [];
                              const updated = e.target.checked
                                ? [...current, opt]
                                : current.filter((x: string) => x !== opt);
                              setDynamicValues({ ...dynamicValues, [field.name]: updated });
                            }}
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
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

            {/* CALL RECORDING AUDIO PLAYER (Exact design from Slide 5) */}
            <div className="rounded-xl p-3.5 bg-slate-900/90 border border-slate-700/80 shadow-inner">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                  Grabación de Llamada (Voz y Validación 30s)
                </span>
                <div className="flex items-center gap-2 font-mono">
                  <span>Duración: {callDurationSeconds}s</span>
                  {/* Quick test buttons to simulate <30s and >30s for Slide 6 testing */}
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
                      Estado cambia a Resuelto. Removido de lista diaria.
                    </span>
                  ) : (
                    <span className="text-red-300">
                      {validationReport.errorMessage} Cliente permanece en lista para revisión.
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
    </div>
  );
};
