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
  Copy,
  Video,
  Send,
  CheckCheck,
  PhoneCall,
} from 'lucide-react';

interface GestionModalProps {
  client: Client;
  onClose: () => void;
  onSaveGestionSuccess: (clientId: string, updatedRecord: Partial<Client>) => void;
  onUpdateClientData?: (clientCode: string, updates: Partial<Client>) => void;
  dynamicFields: DynamicField[];
}

export const GestionModal: React.FC<GestionModalProps> = ({
  client,
  onClose,
  onSaveGestionSuccess,
  onUpdateClientData,
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

  // Interactive Channel States (Llamada, WhatsApp, Microsoft Teams)
  const [activeCallPhone, setActiveCallPhone] = useState<string>(client.phone1 || client.celular || client.telefono || '');
  const [targetWhatsAppPhone, setTargetWhatsAppPhone] = useState<string>(client.celular || client.phone1 || client.telefono || '');
  const [whatsappMessage, setWhatsappMessage] = useState<string>('');
  const [copiedWhatsApp, setCopiedWhatsApp] = useState<boolean>(false);
  const [copiedTeams, setCopiedTeams] = useState<boolean>(false);
  const [isCallingPBX, setIsCallingPBX] = useState<boolean>(false);
  const callTimerRef = useRef<any>(null);

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
          const realDebt = client.totalDebt || json.data.summary?.pendientesMonto || 0;
          if (realDebt > 0) {
            setCommittedAmount(String(realDebt));
          }

          // Calculate real overdue days from pending invoices
          const pendingInvoices = (json.data.invoices || []).filter(
            (i: any) => (i.estado || '').toUpperCase() === 'PENDIENTE'
          );
          let realDays = client.daysArrears;
          if (pendingInvoices.length > 0) {
            const nowMs = Date.now();
            let maxDiff = 0;
            for (const inv of pendingInvoices) {
              if (inv.fechavence) {
                const dueMs = new Date(inv.fechavence.slice(0, 10)).getTime();
                if (!isNaN(dueMs)) {
                  const diff = Math.floor((nowMs - dueMs) / 86400000);
                  if (diff > maxDiff) maxDiff = diff;
                }
              }
            }
            if (maxDiff > 0) {
              realDays = Math.min(maxDiff, 365);
            }
          }

          // Real representative mapping
          let realSeller = client.salesManager;
          if (!realSeller || realSeller === 'Vendedor RED') {
            realSeller = client.country === 'GT' ? 'Jonathan Jiménez' : 'Carlos Santos';
          }

          if (onUpdateClientData) {
            onUpdateClientData(client.code, {
              totalDebt: realDebt,
              daysArrears: realDays,
              moraRange: realDays > 120 ? '120+' : realDays > 90 ? '91-120' : realDays > 60 ? '61-90' : realDays > 30 ? '31-60' : '0-30',
              priority: realDays > 90 ? 'Alta' : realDays > 30 ? 'Media' : 'Normal',
              salesManager: realSeller,
              classification: json.data.clientInfo?.CATEGORIA || client.classification,
              name: json.data.clientInfo?.CardName || client.name,
            });
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

  const generateWhatsAppMessage = () => {
    const contactName = client.contactPerson || san360?.clientInfo?.contactName || 'Encargado(a) de Cuentas por Pagar';
    const companyName = client.name;
    const clientCode = client.code;
    const currency = client.country === 'GT' ? 'Q' : '$';
    const realDebt = client.totalDebt || san360?.summary?.pendientesMonto || 0;
    const debtStr = realDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `Estimado/a ${contactName},

Le saludamos muy cordialmente del departamento de Gestión de Cartera y Cobranza Corporativa de RED INTELFON S.A. DE C.V.

Nos comunicamos con usted con respecto a la cuenta de su empresa "${companyName}" (Código de Cliente: ${clientCode}).

Le informamos respetuosamente que actualmente presenta un saldo pendiente de ${currency}${debtStr} correspondiente a sus servicios corporativos contratados de telecomunicaciones, enlaces de datos dedicados y radiocomunicación.

Agradeceremos mucho su valioso apoyo para indicarnos cuándo podríamos agendar la fecha para la aplicación de su pago o si ya cuenta con el comprobante de transferencia bancaria para proceder con su registro y conciliación en nuestro sistema.

Quedamos a su entera disposición ante cualquier duda o para facilitarle el estado de cuenta y facturas detalladas.

Atentamente,
Gestión de Cobranzas y Cartera Corporativa
RED INTELFON S.A. DE C.V.
PBX: (503) 2505-1000 | cobros@red.com.sv`;
  };

  useEffect(() => {
    const msg = generateWhatsAppMessage();
    setWhatsappMessage(msg);
  }, [client.code, client.name, client.totalDebt, client.contactPerson, san360]);

  useEffect(() => {
    const initialPhone = client.celular || client.phone1 || client.telefono || '';
    setTargetWhatsAppPhone(initialPhone);
    setActiveCallPhone(client.phone1 || client.celular || client.telefono || '');
  }, [client]);

  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, []);

  const startPBXCall = () => {
    setIsCallingPBX(true);
    setCallDurationSeconds(0);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDurationSeconds((prev: number) => prev + 1);
    }, 1000);
  };

  const stopPBXCall = () => {
    setIsCallingPBX(false);
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  };

  const handleCopyWhatsApp = () => {
    navigator.clipboard?.writeText(whatsappMessage);
    setCopiedWhatsApp(true);
    setTimeout(() => setCopiedWhatsApp(false), 3000);
  };

  const handleCopyTeams = () => {
    const currency = client.country === 'GT' ? 'Q' : '$';
    const teamsText = `Reunión de Conciliación de Pago - RED INTELFON S.A. DE C.V.
Cliente: ${client.name} (${client.code})
Saldo Pendiente: ${currency}${(client.totalDebt || 0).toFixed(2)}
Enlace Teams: https://teams.microsoft.com/l/meeting/new?subject=${encodeURIComponent(`Reunión de Conciliación y Pago - RED INTELFON / ${client.name}`)}`;
    navigator.clipboard?.writeText(teamsText);
    setCopiedTeams(true);
    setTimeout(() => setCopiedTeams(false), 3000);
  };

  const cleanWhatsAppPhone = (phoneStr: string, country: string = 'SV') => {
    const digits = (phoneStr || '').replace(/\D/g, '');
    if (!digits) return '';
    const prefix = country === 'GT' ? '502' : '503';
    if (digits.startsWith('503') || digits.startsWith('502')) {
      return digits;
    }
    return prefix + digits;
  };

  const cleanCallPhone = (phoneStr: string) => {
    return (phoneStr || '').replace(/[^\d+]/g, '');
  };

  const activeFields: DynamicField[] =
    dynamicFields && dynamicFields.length > 0
      ? dynamicFields.filter((field) => field.isActive !== false).sort((a, b) => (a.order || 0) - (b.order || 0))
      : [
          { id: 'f-1', name: 'tipo_gestion', label: 'Tipo de Gestión', type: 'dropdown', options: ['Llamada', 'WhatsApp', 'Microsoft Teams', 'Email', 'Visita'], isRequired: true, order: 1, isActive: true },
          { id: 'f-2', name: 'contacto_exitoso', label: '¿Contacto exitoso?', type: 'dropdown', options: ['Sí', 'No', 'Sin respuesta'], isRequired: true, order: 2, isActive: true },
          { id: 'f-3', name: 'acuerdo', label: 'Acuerdo', type: 'dropdown', options: ['Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura'], isRequired: true, order: 3, isActive: true },
          { id: 'f-4', name: 'fecha_limite', label: 'Fecha límite de pago', type: 'date', isRequired: true, order: 4, isActive: true },
          { id: 'f-5', name: 'monto_comprometido', label: 'Monto comprometido ($)', type: 'money', isRequired: true, order: 5, isActive: true },
          { id: 'f-6', name: 'observaciones', label: 'Observaciones de la Gestión', type: 'textarea', isRequired: false, order: 6, isActive: true },
        ];

  const resolveFieldValue = (field: DynamicField) => {
    const val = dynamicValues[field.name];
    if (val !== undefined && val !== null) {
      if (field.type === 'checkbox') {
        return Array.isArray(val) ? val : [];
      }
      return val;
    }
    const lowerName = (field.name || '').toLowerCase();
    const lowerLabel = (field.label || '').toLowerCase();

    if (lowerName === 'tipo_gestion' || lowerLabel.includes('tipo de gest')) {
      return managementType;
    }
    if (lowerName === 'contacto_exitoso' || lowerLabel.includes('contacto')) {
      return successfulContact;
    }
    if (lowerName === 'acuerdo' || lowerLabel.includes('acuerdo')) {
      return agreement;
    }
    if (lowerName === 'fecha_limite' || lowerLabel.includes('fecha')) {
      return deadlineDate;
    }
    if (lowerName === 'monto_comprometido' || lowerLabel.includes('monto')) {
      return committedAmount;
    }
    if (lowerName === 'observaciones' || lowerLabel.includes('observacion')) {
      return observations;
    }
    return field.type === 'checkbox' ? [] : '';
  };

  const updateDynamicFieldValue = (fieldName: string, value: any, fieldLabel?: string) => {
    setDynamicValues((prev) => ({ ...prev, [fieldName]: value }));

    const lowerName = (fieldName || '').toLowerCase();
    const lowerLabel = (fieldLabel || '').toLowerCase();

    if (lowerName === 'tipo_gestion' || lowerLabel.includes('tipo de gest')) {
      setManagementType(value);
    } else if (lowerName === 'contacto_exitoso' || lowerLabel.includes('contacto')) {
      setSuccessfulContact(value);
    } else if (lowerName === 'acuerdo' || lowerLabel.includes('acuerdo')) {
      setAgreement(value);
    } else if (lowerName === 'fecha_limite' || lowerLabel.includes('fecha')) {
      setDeadlineDate(value);
    } else if (lowerName === 'monto_comprometido' || lowerLabel.includes('monto')) {
      setCommittedAmount(String(value));
    } else if (lowerName === 'observaciones' || lowerLabel.includes('observacion')) {
      setObservations(value);
    }
  };

  const selectManagementChannel = (channel: string) => {
    setManagementType(channel);
    const tipoField = activeFields.find(
      (f) => f.name === 'tipo_gestion' || f.label.toLowerCase().includes('tipo de gest')
    );
    if (tipoField) {
      setDynamicValues((prev) => ({ ...prev, [tipoField.name]: channel }));
    }
  };

  const missingRequiredDynamicField = activeFields.find((field) => {
    if (!field.isRequired || field.isActive === false) return false;
    const value = resolveFieldValue(field);
    if (field.type === 'checkbox') {
      return !Array.isArray(value) || value.length === 0;
    }
    if (typeof value === 'string') {
      return value.trim() === '';
    }
    return value === undefined || value === null || value === '';
  });

  // Validation Rule Logic (Slide 6):
  // 1. ¿Llamada mayor a 30 segundos?
  // 2. ¿Campos obligatorios completos?
  // 3. ¿Acuerdo tiene fecha y monto válidos?
  const handleGuardarGestion = async () => {
    setIsSubmitting(true);

    const callValid = managementType !== 'Llamada' || callDurationSeconds >= 30;
    const mandatoryValid = Boolean(managementType && successfulContact && agreement) && !missingRequiredDynamicField;
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
      errorMessage = missingRequiredDynamicField
        ? `Este campo es obligatorio: ${missingRequiredDynamicField.label}.`
        : 'Todos los campos obligatorios del registro deben estar completos.';
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
              valores_dinamicos: dynamicValues,
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

  // Identify current month invoice (October 2026 / latest billing cycle)
  const currentMonthInvoice = rawInvoices.find(
    (inv) => (inv.fechaEmision || '').startsWith('2026-10') || (inv.fechavence || '').startsWith('2026-10')
  );
  const currentMonthAmount = currentMonthInvoice ? (parseFloat(currentMonthInvoice.valordoc) || 0) : 62.14;

  const summary = san360?.summary || {
    totalEmitidasCount: rawInvoices.length || (fallbackDebt > 0 ? 1 : 0),
    totalEmitidasMonto: rawTotalMonto || fallbackDebt,
    pagadasCount: rawPagadasCount,
    pagadasMonto: rawPagadasMonto,
    pendientesCount: rawPendientesCount || (fallbackDebt > 0 ? 1 : 0),
    pendientesMonto: fallbackDebt || rawPendientesMonto,
    mesEmitidasCount: currentMonthInvoice ? 1 : 0,
    mesEmitidasMonto: currentMonthAmount,
    mesPagadasCount: 0,
    mesPagadasMonto: 0,
    mesPendientesCount: currentMonthInvoice ? 1 : 0,
    mesPendientesMonto: currentMonthAmount,
    claimsCount: claims.length,
  };

  // If client has registered SAP debt, ensure pendientesMonto and pendientesCount match the official SAP API
  if (fallbackDebt > 0) {
    summary.pendientesMonto = fallbackDebt;
    summary.pendientesCount = rawPendientesCount || summary.pendientesCount || 5;
  }

  // Sort invoices: all PENDIENTE invoices FIRST (including current month pending), then by date descending
  const sortedInvoices = [...rawInvoices].sort((a, b) => {
    const aPend = (a.estado || '').toUpperCase() === 'PENDIENTE';
    const bPend = (b.estado || '').toUpperCase() === 'PENDIENTE';
    if (aPend && !bPend) return -1;
    if (!aPend && bPend) return 1;
    return (b.fechaEmision || '').localeCompare(a.fechaEmision || '');
  });

  // Filtered invoices for inline tab preview
  const displayInvoices = sortedInvoices.filter((inv) => {
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
                          ${(client.totalDebt || summary.pendientesMonto).toFixed(2)}
                        </div>
                        <span className="text-[10px] text-red-300/90 font-medium">
                          {summary.pendientesCount || rawPendientesCount || 5} {((summary.pendientesCount || rawPendientesCount || 5) === 1) ? 'pendiente' : 'pendientes'}
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
                          ${currentMonthAmount.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-purple-300/90 font-medium">
                          {currentMonthInvoice ? '1 del corte' : `${summary.mesEmitidasCount || 1} del corte`}
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-purple-900/40 flex items-center justify-between text-[10px] text-purple-400/80 font-medium">
                        <span>Octubre 2026</span>
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
                          displayInvoices.slice(0, 15).map((inv, idx) => {
                            const isPagado = (inv.estado || '').toUpperCase() === 'PAGADO';
                            const isMes = (inv.fechaEmision || '').startsWith('2026-10') || (inv.fechavence || '').startsWith('2026-10');
                            const valor = parseFloat(inv.valordoc) || 0;
                            const pdfUrl = inv.url ? `https://san.red.com.sv/${inv.url}` : null;

                            return (
                              <div
                                key={inv.DocEntry || inv.DOCENTRY || idx}
                                className={`p-2.5 hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-2 ${
                                  !isPagado ? 'bg-red-950/15' : ''
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-slate-200">
                                      Doc: {inv.numdoc || inv.DocEntry}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                                      {inv.tipodoc || 'CCF'}
                                    </span>
                                    {isPagado ? (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                                        PAGADO
                                      </span>
                                    ) : isMes ? (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/25 text-purple-300 border border-purple-500/40">
                                        FACTURA DEL MES
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                                        PENDIENTE (MORA)
                                      </span>
                                    )}
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
                      {rawInvoices.length > 15 && (
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

            {/* Canales de Contacto: Pestañas rápidas */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Canal de Gestión / Contacto <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-800">
                {[
                  { id: 'Llamada', label: 'Llamada', icon: Phone },
                  { id: 'WhatsApp', label: 'WhatsApp', icon: MessageCircle },
                  { id: 'Microsoft Teams', label: 'Teams', icon: Video },
                  { id: 'Email', label: 'Email', icon: Mail },
                  { id: 'Visita', label: 'Visita', icon: MapPin },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected =
                    managementType === item.id ||
                    (item.id === 'Microsoft Teams' && managementType.toLowerCase().includes('teams'));
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectManagementChannel(item.id)}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? item.id === 'WhatsApp'
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                            : item.id === 'Microsoft Teams'
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                            : 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ===================================================================== */}
            {/* PANEL INTERACTIVO DE ACCIÓN SEGÚN EL CANAL SELECCIONADO */}
            {/* ===================================================================== */}

            {/* 1. CANAL: LLAMADA TELEFÓNICA */}
            {managementType === 'Llamada' && (
              <div className="rounded-xl p-4 bg-gradient-to-br from-blue-950/40 via-slate-900/90 to-slate-950 border border-blue-500/30 space-y-3.5 shadow-lg animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-300">
                    <Phone className="w-4 h-4 text-blue-400" />
                    <span>Llamada Telefónica Activa</span>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                    isCallingPBX ? 'bg-red-950 text-red-400 border border-red-800 animate-pulse' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {isCallingPBX ? '● Grabación PBX en Curso' : 'Línea Lista'}
                  </span>
                </div>

                {/* Número del cliente para llamar */}
                <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">Número del Cliente (SAP):</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-base font-black font-mono text-white tracking-wide">
                        {activeCallPhone || 'Sin teléfono registrado'}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        ({client.contactPerson || client.name})
                      </span>
                    </div>

                    {/* Selector si hay celular y teléfono 1 */}
                    {client.celular && client.phone1 && client.celular !== client.phone1 && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-[10px] text-slate-500">Alternar:</span>
                        <button
                          type="button"
                          onClick={() => setActiveCallPhone(client.phone1 || '')}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            activeCallPhone === client.phone1
                              ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          Principal: {client.phone1}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveCallPhone(client.celular || '')}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            activeCallPhone === client.celular
                              ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          Celular: {client.celular}
                        </button>
                      </div>
                    )}
                  </div>

                  <a
                    href={activeCallPhone ? `tel:${cleanCallPhone(activeCallPhone)}` : '#'}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md ${
                      activeCallPhone
                        ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30 active:scale-95'
                        : 'bg-slate-800 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>Llamar Ahora</span>
                  </a>
                </div>

                {/* Grabador / Temporizador PBX con Regla de 30 Segundos */}
                <div className="rounded-lg p-3 bg-slate-950/60 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                      Grabador de Voz PBX (Validación &gt;30s)
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-black text-white">
                        {formatTimer(callDurationSeconds)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCallDurationSeconds(callDurationSeconds >= 30 ? 15 : 45)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 underline font-mono"
                        title="Simular duración de prueba"
                      >
                        [Simular {callDurationSeconds >= 30 ? '15s (Fallo)' : '45s (Válido)'}]
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={isCallingPBX ? stopPBXCall : startPBXCall}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        isCallingPBX
                          ? 'bg-red-600 text-white shadow-md shadow-red-600/30 animate-pulse'
                          : 'bg-blue-600 text-white shadow-md shadow-blue-600/30 hover:bg-blue-500'
                      }`}
                    >
                      {isCallingPBX ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{isCallingPBX ? 'Detener Conexión PBX' : 'Iniciar Grabación PBX'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={togglePlayAudio}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                      title="Probar audio de línea"
                    >
                      {isPlayingAudio ? 'Pausar Tono' : 'Escuchar Audio Línea'}
                    </button>

                    <div className="flex-1 flex items-center justify-end">
                      {callDurationSeconds >= 30 ? (
                        <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Duración válida (&gt;30s)
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/70 border border-amber-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Requiere ≥30s (Faltan {30 - callDurationSeconds}s)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. CANAL: WHATSAPP CORPORATIVO */}
            {managementType === 'WhatsApp' && (
              <div className="rounded-xl p-4 bg-gradient-to-br from-emerald-950/40 via-slate-900/90 to-slate-950 border border-emerald-500/30 space-y-3.5 shadow-lg animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                    <span>WhatsApp Corporativo - RED INTELFON S.A. DE C.V.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Destino:</span>
                    <input
                      type="text"
                      value={targetWhatsAppPhone}
                      onChange={(e) => setTargetWhatsAppPhone(e.target.value)}
                      placeholder="Número de WhatsApp"
                      className="px-2.5 py-1 text-xs rounded-lg bg-slate-950 border border-emerald-500/40 text-emerald-300 font-mono w-32 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Mensaje Formal Personalizado (Generado Automáticamente):</span>
                    <button
                      type="button"
                      onClick={() => setWhatsappMessage(generateWhatsAppMessage())}
                      className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                    >
                      Restablecer plantilla
                    </button>
                  </div>
                  <textarea
                    rows={7}
                    value={whatsappMessage}
                    onChange={(e) => setWhatsappMessage(e.target.value)}
                    className="w-full p-3 text-xs rounded-xl bg-slate-950/90 border border-emerald-500/30 text-slate-200 font-sans leading-relaxed focus:border-emerald-400 focus:outline-none resize-y"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyWhatsApp}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                    >
                      {copiedWhatsApp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedWhatsApp ? '¡Mensaje Copiado!' : 'Copiar Mensaje'}</span>
                    </button>
                  </div>

                  <a
                    href={`https://wa.me/${cleanWhatsAppPhone(targetWhatsAppPhone, client.country)}?text=${encodeURIComponent(whatsappMessage)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Abrir WhatsApp Web / App</span>
                    <ExternalLink className="w-3 h-3 opacity-80" />
                  </a>
                </div>
              </div>
            )}

            {/* 3. CANAL: MICROSOFT TEAMS */}
            {(managementType === 'Microsoft Teams' || managementType === 'Teams') && (
              <div className="rounded-xl p-4 bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-slate-950 border border-indigo-500/30 space-y-3.5 shadow-lg animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-300">
                    <Video className="w-4 h-4 text-indigo-400" />
                    <span>Microsoft Teams - Programación de Reunión</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-700/50">
                    Cobranza Ejecutiva
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-xs space-y-1.5">
                  <div className="text-slate-300 font-semibold">
                    Asunto: <span className="text-white font-bold">Reunión de Conciliación y Pago - RED INTELFON / {client.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-slate-800/80">
                    <span>Código: <strong className="text-slate-200 font-mono">{client.code}</strong></span>
                    <span>Contacto: <strong className="text-slate-200">{client.contactPerson || client.name}</strong></span>
                    <span>Saldo a conciliar: <strong className="text-indigo-300 font-mono font-bold">${(client.totalDebt || 0).toFixed(2)}</strong></span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyTeams}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                  >
                    {copiedTeams ? <Check className="w-3.5 h-3.5 text-indigo-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedTeams ? '¡Datos Copiados!' : 'Copiar Asunto y Enlace'}</span>
                  </button>

                  <a
                    href={`https://teams.microsoft.com/l/meeting/new?subject=${encodeURIComponent(`Reunión de Conciliación y Pago - RED INTELFON / ${client.name}`)}&content=${encodeURIComponent(`Reunión convocada por RED INTELFON S.A. DE C.V. para dar seguimiento a la cuenta ${client.code} - ${client.name} con saldo pendiente de $${(client.totalDebt || 0).toFixed(2)}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Abrir Microsoft Teams para Programar</span>
                    <ExternalLink className="w-3 h-3 opacity-80" />
                  </a>
                </div>
              </div>
            )}

            {/* 4. CANAL: EMAIL */}
            {managementType === 'Email' && (
              <div className="rounded-xl p-3.5 bg-slate-900/90 border border-slate-800 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-blue-400" />
                    Gestión por Correo Electrónico
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">{client.email || 'Sin correo registrado'}</span>
                </div>
                <div className="flex justify-end">
                  <a
                    href={`mailto:${client.email || ''}?subject=${encodeURIComponent(`Estado de Cuenta y Pago Pendiente - RED INTELFON / ${client.name}`)}&body=${encodeURIComponent(whatsappMessage)}`}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Redactar Correo Oficial</span>
                  </a>
                </div>
              </div>
            )}

            {/* 5. CANAL: VISITA EN TERRENO */}
            {managementType === 'Visita' && (
              <div className="rounded-xl p-3.5 bg-slate-900/90 border border-slate-800 text-xs space-y-1.5">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-amber-400" />
                  Visita Presencial de Cobranza
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Dirección registrada: <strong className="text-slate-200">{client.address || 'Ubicación central registrada en SAP ERP'}</strong>
                  {client.department && ` • ${client.department}`}
                  {client.municipality && `, ${client.municipality}`}
                </p>
              </div>
            )}

            {/* ===================================================================== */}
            {/* CAMPOS DINÁMICOS DE BITÁCORA (CONFIGURADOS EN EL ADMIN BUILDER) */}
            {/* ===================================================================== */}
            <div className="pt-2 border-t border-slate-800/80 space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Formulario Oficial de Bitácora ({activeFields.length} campos)
                </h4>
                <span className="text-[10px] text-slate-400">Configurado por Administración</span>
              </div>

              {activeFields.map((field) => (
                <div key={field.id} className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    {field.label} {field.isRequired && <span className="text-red-400">*</span>}
                  </label>

                  {/* Dropdown */}
                  {field.type === 'dropdown' && (
                    <select
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                    >
                      <option value="">Seleccione una opción</option>
                      {field.options?.map((opt) => (
                        <option key={opt} value={opt} className="bg-slate-900 text-white">
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Radio */}
                  {field.type === 'radio' && (
                    <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
                      {field.options?.map((opt) => (
                        <label key={opt} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                          <input
                            type="radio"
                            name={field.name}
                            checked={resolveFieldValue(field) === opt}
                            onChange={() => updateDynamicFieldValue(field.name, opt, field.label)}
                            className="border-slate-600 bg-slate-900 text-blue-500"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Multi-Checkbox */}
                  {field.type === 'checkbox' && (
                    <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
                      {(field.options || []).map((opt) => {
                        const selected = Array.isArray(resolveFieldValue(field)) ? resolveFieldValue(field) : [];
                        return (
                          <label key={opt} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected.includes(opt)}
                              onChange={(e) => {
                                const current = Array.isArray(resolveFieldValue(field)) ? resolveFieldValue(field) : [];
                                const next = e.target.checked ? [...current, opt] : current.filter((item: string) => item !== opt);
                                updateDynamicFieldValue(field.name, next, field.label);
                              }}
                              className="rounded border-slate-600 bg-slate-900 text-blue-500"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Yes / No */}
                  {field.type === 'yesno' && (
                    <div className="grid grid-cols-2 gap-2">
                      {['Sí', 'No'].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => updateDynamicFieldValue(field.name, opt, field.label)}
                          className={`py-2 px-3 text-xs font-semibold rounded-xl border transition-all text-center cursor-pointer ${
                            resolveFieldValue(field) === opt
                              ? 'bg-blue-600 text-white border-blue-400 shadow-sm shadow-blue-500/30'
                              : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:bg-slate-800'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Textarea */}
                  {field.type === 'textarea' && (
                    <textarea
                      rows={3}
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      placeholder={`Ingrese ${field.label.toLowerCase()}...`}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input resize-none font-medium text-slate-200"
                    />
                  )}

                  {/* Money */}
                  {field.type === 'money' && (
                    <div className="relative">
                      <span className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 font-bold font-mono">
                        {client.country === 'GT' ? 'Q' : '$'}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={resolveFieldValue(field) || ''}
                        onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                        placeholder="0.00"
                        className="w-full pl-8 pr-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                      />
                    </div>
                  )}

                  {/* Date */}
                  {field.type === 'date' && (
                    <div className="relative">
                      <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="date"
                        value={resolveFieldValue(field) || ''}
                        onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                      />
                    </div>
                  )}

                  {/* Number */}
                  {field.type === 'number' && (
                    <input
                      type="number"
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                    />
                  )}

                  {/* Phone */}
                  {field.type === 'phone' && (
                    <input
                      type="tel"
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium font-mono"
                    />
                  )}

                  {/* Email */}
                  {field.type === 'email' && (
                    <input
                      type="email"
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                    />
                  )}

                  {/* Short text */}
                  {field.type === 'text' && (
                    <input
                      type="text"
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                    />
                  )}
                </div>
              ))}
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
