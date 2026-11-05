import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Agent, AuthUser, Client, DynamicField, RealClient360Data, SanInvoice } from '../types';
import { supabase } from '../supabaseClient';
import { authenticatedApiFetch } from '../services/authService';
import { fetchContactosCobros } from '../services/contactosCobrosService';
import type { ContactoCobros, InformacionCobrosCliente } from '../services/contactosCobrosService';
import confetti from 'canvas-confetti';
import { FacturasModal } from './FacturasModal';
import PbxCallAudioPlayer from './PbxCallAudioPlayer';
import { PbxTranscriptReviewCard } from './PbxTranscriptReviewCard';
import {
  X,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  AlertTriangle,
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
  Send,
  CheckCheck,
  PhoneCall,
  MessageSquareText,
  Bot,
  CalendarClock,
  RotateCcw,
  Plus,
  Trash2,
} from 'lucide-react';
import { MessageScript, AIEvaluationResult, GestionAuditRecord, ClientManagementHistoryItem } from '../types';
import { replaceScriptVariables } from './ScriptsLibraryPanel';
import { INITIAL_MESSAGE_SCRIPTS } from '../data/mockData';
import { getElSalvadorDateKey, getElSalvadorDateParts } from '../utils/gestionDates';
import { resolveContactAutofill } from '../utils/contactAutofill';

interface GestionModalProps {
  client: Client;
  currentUser: AuthUser;
  activeAgent?: Agent;
  onClose: () => void;
  onSaveGestionSuccess: (clientId: string, updatedRecord: Partial<Client>, auditRecord?: GestionAuditRecord) => void;
  existingRecord?: GestionAuditRecord;
  onUpdateClientData?: (clientCode: string, updates: Partial<Client>) => void;
  dynamicFields: DynamicField[];
  scripts?: MessageScript[];
  onRescheduleClient?: (clientCode: string, targetDate: string, reason?: string) => void;
}

type ReclamoSla = {
  case_id?: string | number;
  tipo?: string | null;
  estado?: string;
  asunto?: string | null;
  descripcion?: string | null;
  resolucion?: string | null;
  fecha_creacion?: string;
  fecha_actualizacion?: string;
  fecha_fin_resolucion?: string | null;
  agente?: { nombre?: string; email?: string } | null;
  categoria?: { nombre?: string; categoria?: string; name?: string; label?: string } | string | null;
};

type ReclamosSlaLinkDiagnostics = {
  casosConCliente: number;
  casosConCodigoCliente: number;
  casosConNombreCliente: number;
  coincidenciasCodigo: number;
  coincidenciasNombre: number;
};

type ContactoDraft = {
  nombre: string;
  telefono: string;
  correo: string;
  cargo: string;
};

type PbxCallOption = {
  callId: string;
  extension: string;
  profileExtension?: string;
  extensionMatchesProfile?: boolean;
  matchedBy?: 'username' | 'extension';
  username: string;
  callDate: string;
  dateTime: string;
  origin: string;
  destination: string;
  durationSeconds: number;
  state: string;
  recordingFile: string;
  matchesClientPhone: boolean;
  matchesSelectedPhone?: boolean;
  audioUrl: string;
};

const PAYMENT_RECEIPT_BUCKET = 'comprobantes-pago';

function createAuditSubmissionId(): string {
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `audit-${randomId}`;
}
const MAX_PAYMENT_RECEIPT_BYTES = 50 * 1024 * 1024;
const PAYMENT_RECEIPT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const SAC_NEW_CASE_URL = 'https://sac-ruby.vercel.app/#/public/nuevo-caso';

const formatSanCurrency = (value: unknown, country: Client['country']): string => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const locale = country === 'GT' ? 'es-GT' : 'en-US';
  const symbol = country === 'GT' ? 'Q' : '$';
  return `${symbol}${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const isClosedClaim = (status: unknown) =>
  ['finalizado', 'finalizada', 'cerrado', 'cerrada', 'resuelto', 'resuelta'].includes(
    String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
  );

const normalizeSanInvoiceStatus = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const isVoidedSanInvoice = (value: unknown): boolean =>
  ['ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA'].includes(normalizeSanInvoiceStatus(value));

const isPaidSanInvoice = (value: unknown): boolean =>
  ['PAGADO', 'PAGADA'].includes(normalizeSanInvoiceStatus(value));

const isPendingSanInvoice = (value: unknown): boolean =>
  normalizeSanInvoiceStatus(value).startsWith('PENDIENTE');

const isPartialSanInvoice = (value: unknown): boolean =>
  normalizeSanInvoiceStatus(value).startsWith('PAGO PARCIAL');

const parseSanAmount = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
};

const getSanInvoiceOutstanding = (invoice: SanInvoice): number | null => {
  const status = normalizeSanInvoiceStatus(invoice.estado);
  if (isVoidedSanInvoice(status) || isPaidSanInvoice(status)) return 0;

  const amount = parseSanAmount(invoice.valordoc);
  if (amount === null) return null;
  if (isPendingSanInvoice(status)) return Math.max(0, amount);
  if (isPartialSanInvoice(status)) {
    const paid = parseSanAmount(invoice.pago);
    return paid === null ? null : Math.max(0, amount - paid);
  }
  return null;
};

export const GestionModal: React.FC<GestionModalProps> = ({
  client,
  currentUser,
  activeAgent,
  onClose,
  onSaveGestionSuccess,
  existingRecord,
  onUpdateClientData,
  dynamicFields,
  scripts = INITIAL_MESSAGE_SCRIPTS,
  onRescheduleClient,
}) => {
  const existingValues = existingRecord?.dynamicValues || {};
  const existingPbxCall = existingValues.pbxCall && typeof existingValues.pbxCall === 'object'
    ? existingValues.pbxCall as Record<string, unknown>
    : null;
  const existingPaymentReceiptPath = typeof existingValues.paymentEvidencePath === 'string'
    ? existingValues.paymentEvidencePath
    : '';
  const existingAgreementDetails = String(existingValues.agreementDetails || '').trim();
  const initialObservations = (() => {
    const saved = existingRecord?.observations || '';
    return existingAgreementDetails && saved.startsWith(existingAgreementDetails)
      ? saved.slice(existingAgreementDetails.length).trim()
      : saved;
  })();

  // Real 360 Data from SAN API
  const [san360, setSan360] = useState<RealClient360Data | null>(null);
  const [isLoading360, setIsLoading360] = useState<boolean>(true);
  const [fetchError360, setFetchError360] = useState<string | null>(null);

  // Invoices modal filter (opened when clicking on the top cajitas or 'ver todas')
  const [invoiceModalFilter, setInvoiceModalFilter] = useState<'pendientes' | 'mes' | 'pagadas' | 'todas' | null>(null);
  const [sectionATab, setSectionATab] = useState<'facturas' | 'cliente' | 'anexos' | 'reclamos' | 'pagos' | 'equipos'>('facturas');
  const [invoiceSearch, setInvoiceSearch] = useState<string>('');
  const [claimsFilter, setClaimsFilter] = useState<'TODOS' | 'FINALIZADOS' | 'ABIERTOS'>('TODOS');
  const [claimsSearch, setClaimsSearch] = useState<string>('');
  const [reclamosSla, setReclamosSla] = useState<ReclamoSla[]>([]);
  const [reclamosSlaPaisTotal, setReclamosSlaPaisTotal] = useState<number | null>(null);
  const [reclamosSlaLinkDiagnostics, setReclamosSlaLinkDiagnostics] =
    useState<ReclamosSlaLinkDiagnostics | null>(null);
  const [isLoadingReclamosSla, setIsLoadingReclamosSla] = useState<boolean>(true);
  const [reclamosSlaError, setReclamosSlaError] = useState<string | null>(null);
  const reclamosRequestId = useRef(0);
  const pendingSubmissionId = useRef<{ signature: string; id: string } | null>(null);
  const [cobrosContacts, setCobrosContacts] = useState<ContactoCobros[]>([]);
  const [cobrosClientInfo, setCobrosClientInfo] = useState<InformacionCobrosCliente | null>(null);
  const [isLoadingCobrosContacts, setIsLoadingCobrosContacts] = useState<boolean>(true);
  const [requiresSupabaseAuth, setRequiresSupabaseAuth] = useState<boolean>(false);
  const [cobrosContactsError, setCobrosContactsError] = useState<string | null>(null);
  const [contactsToAdd, setContactsToAdd] = useState<ContactoDraft[]>([]);

  useEffect(() => {
    let isCurrentClient = true;
    setIsLoadingCobrosContacts(true);
    setCobrosContacts([]);
    setCobrosClientInfo(null);
    setRequiresSupabaseAuth(false);
    setCobrosContactsError(null);

    fetchContactosCobros(client.code, client.country)
      .then((result) => {
        if (!isCurrentClient) return;
        setCobrosContacts(result.contacts);
        setCobrosClientInfo(result.clientInfo);
        setRequiresSupabaseAuth(result.requiresSupabaseAuth);
        setCobrosContactsError(result.error);
      })
      .catch(() => {
        if (isCurrentClient) {
          setCobrosContactsError('No se pudieron cargar los contactos de cobros.');
        }
      })
      .finally(() => {
        if (isCurrentClient) setIsLoadingCobrosContacts(false);
      });

    return () => {
      isCurrentClient = false;
    };
  }, [client.code, client.country]);

  const loadReclamosSla = useCallback(async (forceRefresh = false) => {
    const requestId = ++reclamosRequestId.current;
    setIsLoadingReclamosSla(true);
    setReclamosSlaError(null);
    const params = new URLSearchParams({
      pais: client.country,
      clienteCodigo: client.code,
      clienteNombre: client.name,
    });
    if (forceRefresh) params.set('actualizar', '1');
    try {
      const response = await authenticatedApiFetch(`/api/reclamos?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        const message = payload.error === 'RECLAMOS_API_NOT_CONFIGURED'
          ? 'La API de reclamos aún no está configurada en Vercel.'
          : 'No se pudieron consultar los reclamos del cliente.';
        throw new Error(message);
      }
      if (reclamosRequestId.current !== requestId) return;
      setReclamosSla(Array.isArray(payload.reclamos) ? payload.reclamos : []);
      setReclamosSlaPaisTotal(
        typeof payload.totalCasosPais === 'number' ? payload.totalCasosPais : null
      );
      const linkDiagnostics = payload.enlaceCliente;
      setReclamosSlaLinkDiagnostics(
        linkDiagnostics && typeof linkDiagnostics === 'object'
          ? {
              casosConCliente: Number(linkDiagnostics.casosConCliente) || 0,
              casosConCodigoCliente: Number(linkDiagnostics.casosConCodigoCliente) || 0,
              casosConNombreCliente: Number(linkDiagnostics.casosConNombreCliente) || 0,
              coincidenciasCodigo: Number(linkDiagnostics.coincidenciasCodigo) || 0,
              coincidenciasNombre: Number(linkDiagnostics.coincidenciasNombre) || 0,
            }
          : null
      );
    } catch (error) {
      if (reclamosRequestId.current === requestId) {
        setReclamosSlaError(error instanceof Error ? error.message : 'No se pudieron consultar los reclamos.');
      }
    } finally {
      if (reclamosRequestId.current === requestId) setIsLoadingReclamosSla(false);
    }
  }, [client.code, client.country, client.name]);

  useEffect(() => {
    setReclamosSla([]);
    setReclamosSlaPaisTotal(null);
    setReclamosSlaLinkDiagnostics(null);
    void loadReclamosSla();
    return () => {
      reclamosRequestId.current += 1;
    };
  }, [loadReclamosSla]);

  // Form fields
  const initialContact = String(existingRecord?.contactSuccess || existingValues.contacto_exitoso || '');
  const initialAgreement = existingRecord?.agreement || String(existingValues.acuerdo || '');
  const [managementType, setManagementType] = useState<string>(
    existingRecord?.channel || String(existingValues.contactChannel || existingValues.tipo_gestion || 'Llamada')
  );
  const [successfulContact, setSuccessfulContact] = useState<'' | 'Sí' | 'No' | 'Sin respuesta'>(
    initialContact.toLocaleLowerCase() === 'si' || initialContact.toLocaleLowerCase() === 'sí'
      ? 'Sí'
      : initialContact.toLocaleLowerCase() === 'no'
        ? 'No'
        : initialContact.toLocaleLowerCase() === 'sin respuesta'
          ? 'Sin respuesta'
          : ''
  );
  const [agreement, setAgreement] = useState<string>(initialAgreement);
  const [isPaymentOutcome, setIsPaymentOutcome] = useState(
    initialAgreement === 'Pago realizado' || existingValues.paymentOutcome === 'payment_received'
  );
  const [paymentDate, setPaymentDate] = useState<string>(
    String(existingValues.paymentDate || getElSalvadorDateKey())
  );
  const [paymentMadeBy, setPaymentMadeBy] = useState(String(existingValues.paymentMadeBy || ''));
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [deadlineDate, setDeadlineDate] = useState<string>(
    existingRecord?.deadlineDate || ''
  );
  const [committedAmount, setCommittedAmount] = useState<string>(
    existingRecord?.committedAmount ? String(existingRecord.committedAmount) : ''
  );
  const [observations, setObservations] = useState<string>(initialObservations);
  const [contactName, setContactName] = useState(
    existingRecord?.contactName || String(existingValues.contactName || '')
  );
  const [contactPhone, setContactPhone] = useState(
    existingRecord?.contactPhone || String(existingValues.contactPhone || '')
  );
  const [contactEmail, setContactEmail] = useState(
    existingRecord?.contactEmail || String(existingValues.contactEmail || '')
  );
  const contactNameManuallyEditedRef = useRef(false);
  const contactPhoneManuallyEditedRef = useRef(false);
  const contactEmailManuallyEditedRef = useRef(false);
  const [promiseTime, setPromiseTime] = useState(
    existingRecord?.promiseTime || String(existingValues.promiseTime || '')
  );
  const [rescheduleDate, setRescheduleDate] = useState(
    String(existingValues.rescheduleDate || existingValues.scheduledDate || '')
  );
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>(existingValues);
  const managementAgentId = activeAgent?.id || currentUser.id;
  const managementAgentName = activeAgent?.name || currentUser.name;
  const currentMonthLabel = new Intl.DateTimeFormat('es-SV', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/El_Salvador',
  }).format(new Date());
  const todayKey = getElSalvadorDateKey();
  const todayParts = getElSalvadorDateParts();
  const currentMonthStart = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-01`;
  const currentMonthEnd = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(new Date(todayParts.year, todayParts.month, 0).getDate()).padStart(2, '0')}`;
  const pbxCallDate = String(existingPbxCall?.date || existingRecord?.scheduledForDate
    || client.portfolioDateForGestion || client.scheduledDate || todayKey);
  const pbxDestinationDefault = [
    existingPbxCall?.searchedPhone,
    client.phone1,
    client.phone2,
    client.celular,
    client.telefono,
  ].find((phone) => String(phone || '').replace(/\D/g, '').length >= 8) || '';
  const pbxClientPhones = [...new Set([
    client.phone1,
    client.phone2,
    client.celular,
    client.telefono,
  ].map((phone) => String(phone || '').trim()).filter((phone) => phone.replace(/\D/g, '').length >= 8))];
  const pbxPhoneListId = `pbx-client-phones-${client.code.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [pbxDestinationPhone, setPbxDestinationPhone] = useState(String(pbxDestinationDefault));
  const [appliedPbxDestinationPhone, setAppliedPbxDestinationPhone] = useState(String(pbxDestinationDefault));
  const [pbxRangeFrom, setPbxRangeFrom] = useState(`${pbxCallDate}T00:00`);
  const [pbxRangeTo, setPbxRangeTo] = useState(`${pbxCallDate}T23:59`);
  const [appliedPbxRangeFrom, setAppliedPbxRangeFrom] = useState(`${pbxCallDate}T00:00`);
  const [appliedPbxRangeTo, setAppliedPbxRangeTo] = useState(`${pbxCallDate}T23:59`);
  const [pbxRangeValidationError, setPbxRangeValidationError] = useState('');
  const [pbxRefreshKey, setPbxRefreshKey] = useState(0);
  const [pbxCalls, setPbxCalls] = useState<PbxCallOption[]>([]);
  const [pbxCallsLoading, setPbxCallsLoading] = useState(false);
  const [pbxCallsError, setPbxCallsError] = useState('');
  const [selectedPbxCallId, setSelectedPbxCallId] = useState('');
  const [pbxAudioError, setPbxAudioError] = useState('');
  const [pbxAudioRefreshKey, setPbxAudioRefreshKey] = useState(0);
  const [pbxTranscriptReview, setPbxTranscriptReview] = useState<Record<string, unknown> | null>(null);
  const [pbxTranscriptCallId, setPbxTranscriptCallId] = useState('');
  const [pbxTranscriptLoading, setPbxTranscriptLoading] = useState(false);
  const [pbxTranscriptError, setPbxTranscriptError] = useState('');
  const [pbxTranscriptRefreshKey, setPbxTranscriptRefreshKey] = useState(0);
  const selectedPbxCall = pbxCalls.find((call) => call.callId === selectedPbxCallId) || null;
  const recommendedPbxCallId = [...pbxCalls].sort((left, right) => {
    const leftAnswered = /CONTESTAD|ANSWERED/i.test(left.state || '');
    const rightAnswered = /CONTESTAD|ANSWERED/i.test(right.state || '');
    if (leftAnswered !== rightAnswered) return leftAnswered ? -1 : 1;
    if (left.durationSeconds !== right.durationSeconds) return right.durationSeconds - left.durationSeconds;
    return right.dateTime.localeCompare(left.dateTime);
  })[0]?.callId || '';
  const currentPbxTranscriptReview = selectedPbxCall?.callId === pbxTranscriptCallId
    ? pbxTranscriptReview
    : null;
  const pbxSearchIsStale = pbxDestinationPhone !== appliedPbxDestinationPhone
    || pbxRangeFrom !== appliedPbxRangeFrom
    || pbxRangeTo !== appliedPbxRangeTo;
  const pbxCallRequiredMissing = managementType === 'Llamada'
    && !existingRecord
    && (!selectedPbxCall
      || selectedPbxCall.matchesSelectedPhone !== true
      || pbxSearchIsStale
      || pbxCallsLoading);
  const clientSanInfo = san360?.clientCode?.toUpperCase() === client.code.toUpperCase()
    ? san360.clientInfo
    : null;
  const autoContact = resolveContactAutofill(client, cobrosContacts, clientSanInfo, managementType);
  const { name: autoContactName, phone: autoContactPhone, email: autoContactEmail } = autoContact;

  useEffect(() => {
    const from = `${pbxCallDate}T00:00`;
    const to = `${pbxCallDate}T23:59`;
    setPbxRangeFrom(from);
    setPbxRangeTo(to);
    setAppliedPbxRangeFrom(from);
    setAppliedPbxRangeTo(to);
    setPbxRangeValidationError('');
    setPbxDestinationPhone(String(pbxDestinationDefault));
    setAppliedPbxDestinationPhone(String(pbxDestinationDefault));
    setSelectedPbxCallId('');
    setPbxTranscriptReview(null);
    setPbxTranscriptCallId('');
  }, [client.code, client.country, pbxCallDate, pbxDestinationDefault]);

  useEffect(() => {
    if (managementType !== 'Llamada') return;

    let isMounted = true;
    setPbxCallsLoading(true);
    setPbxCallsError('');
    setPbxCalls([]);
    setSelectedPbxCallId('');
    setPbxTranscriptReview(null);
    setPbxTranscriptCallId('');
    setPbxTranscriptError('');

    if (appliedPbxDestinationPhone.replace(/\D/g, '').length < 8) {
      setPbxCallsError('Ingresa el teléfono de destino del cliente para buscar y asociar una llamada PBX.');
      setPbxCallsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const query = new URLSearchParams({
      action: 'pbx-calls',
      desde: appliedPbxRangeFrom.slice(0, 10),
      hasta: appliedPbxRangeTo.slice(0, 10),
      hora_desde: appliedPbxRangeFrom,
      hora_hasta: appliedPbxRangeTo,
      pais: client.country,
      codigo_cliente: client.code,
      telefono_destino: appliedPbxDestinationPhone,
    });
    authenticatedApiFetch(`/api/cartera?${query.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || 'No se pudieron consultar las llamadas de la PBX.');
        }
        return payload;
      })
      .then((payload) => {
        if (!isMounted) return;
        const calls = Array.isArray(payload.calls) ? payload.calls as PbxCallOption[] : [];
        setPbxCalls(calls);
        const previousCallId = String(existingPbxCall?.uniqueId || '');
        if (previousCallId && calls.some((call) => call.callId === previousCallId)) {
          setSelectedPbxCallId(previousCallId);
        }
        if (calls.length === 0) {
          setPbxCallsError(
            `No se encontró una llamada al ${appliedPbxDestinationPhone} que coincida con el usuario PBX o la extensión configurados dentro del rango. Verifica el teléfono y la fecha/hora; si la llamada aparece en PBX, confirma el correo y la extensión del perfil. Cambia a Correo o WhatsApp si la gestión fue por otro canal; las notas se conservan.`
          );
        }
      })
      .catch((error) => {
        if (isMounted) {
          setPbxCallsError(error instanceof Error ? error.message : 'No se pudieron consultar las llamadas de la PBX.');
        }
      })
      .finally(() => {
        if (isMounted) setPbxCallsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [
    managementType,
    client.code,
    client.country,
    appliedPbxRangeFrom,
    appliedPbxRangeTo,
    appliedPbxDestinationPhone,
    pbxRefreshKey,
    activeAgent?.email,
    activeAgent?.pbxExtension,
    existingRecord?.id,
  ]);

  useEffect(() => {
    if (managementType !== 'Llamada' || !selectedPbxCall) {
      setPbxTranscriptReview(null);
      setPbxTranscriptCallId('');
      setPbxTranscriptError('');
      setPbxTranscriptLoading(false);
      return;
    }

    let isMounted = true;
    setPbxTranscriptLoading(true);
    setPbxTranscriptError('');
    setPbxTranscriptReview(null);
    setPbxTranscriptCallId(selectedPbxCall.callId);
    const query = new URLSearchParams({
      action: 'pbx-transcript',
      pais: client.country,
      codigo_cliente: client.code,
      call_id: selectedPbxCall.callId,
      fecha: selectedPbxCall.callDate,
      telefono_destino: appliedPbxDestinationPhone,
    });
    authenticatedApiFetch(`/api/cartera?${query.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || 'No se pudo consultar la transcripción.');
        }
        return payload;
      })
      .then((payload) => {
        if (!isMounted) return;
        setPbxTranscriptReview(payload);
      })
      .catch((error) => {
        if (isMounted) {
          setPbxTranscriptError(error instanceof Error
            ? error.message
            : 'No se pudo consultar la transcripción.');
        }
      })
      .finally(() => {
        if (isMounted) setPbxTranscriptLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [
    managementType,
    client.code,
    client.country,
    selectedPbxCall?.callId,
    selectedPbxCall?.callDate,
    appliedPbxDestinationPhone,
    pbxTranscriptRefreshKey,
  ]);

  useEffect(() => {
    contactNameManuallyEditedRef.current = false;
    contactPhoneManuallyEditedRef.current = false;
    contactEmailManuallyEditedRef.current = false;
    setContactName('');
    setContactPhone('');
    setContactEmail('');
  }, [client.code]);

  useEffect(() => {
    if (!contactNameManuallyEditedRef.current && autoContactName) {
      setContactName(autoContactName);
    }
    if (!contactPhoneManuallyEditedRef.current && autoContactPhone) {
      setContactPhone(autoContactPhone);
    }
    if (!contactEmailManuallyEditedRef.current && autoContactEmail) {
      setContactEmail(autoContactEmail);
    }
  }, [autoContactEmail, autoContactName, autoContactPhone, client.code]);

  // Interactive Channel States (Llamada, Script Mensaje)
  const [targetWhatsAppPhone, setTargetWhatsAppPhone] = useState<string>(client.celular || client.phone1 || client.telefono || '');
  const [whatsappMessage, setWhatsappMessage] = useState<string>('');
  const [copiedWhatsApp, setCopiedWhatsApp] = useState<boolean>(false);
  useEffect(() => {
    setPbxAudioError('');
  }, [selectedPbxCallId, pbxRefreshKey]);

  const searchPbxCalls = () => {
    const fromDate = pbxRangeFrom.slice(0, 10);
    const toDate = pbxRangeTo.slice(0, 10);
    if (!fromDate || !toDate || !pbxRangeFrom || !pbxRangeTo) {
      setPbxRangeValidationError('Completa la fecha y hora inicial y final.');
      return;
    }
    if (pbxRangeFrom > pbxRangeTo) {
      setPbxRangeValidationError('La fecha y hora inicial debe ser anterior a la final.');
      return;
    }
    const fromDay = Date.parse(`${fromDate}T00:00:00Z`);
    const toDay = Date.parse(`${toDate}T00:00:00Z`);
    const today = Date.parse(`${todayKey}T00:00:00Z`);
    const oldestAllowed = today - 6 * 24 * 60 * 60 * 1000;
    if (
      !Number.isFinite(fromDay)
      || !Number.isFinite(toDay)
      || fromDay < oldestAllowed
      || toDay > today
      || toDay < fromDay
      || toDay - fromDay > 6 * 24 * 60 * 60 * 1000
    ) {
      setPbxRangeValidationError('La PBX permite consultar hasta 7 días, entre hoy y los 6 días anteriores.');
      return;
    }
    setSelectedPbxCallId('');
    setPbxCalls([]);
    setPbxTranscriptReview(null);
    setPbxTranscriptCallId('');
    setPbxTranscriptError('');
    setPbxRangeValidationError('');
    setAppliedPbxRangeFrom(pbxRangeFrom);
    setAppliedPbxRangeTo(pbxRangeTo);
    setAppliedPbxDestinationPhone(pbxDestinationPhone);
    setPbxRefreshKey((value) => value + 1);
  };

  // Message Scripts Library Selection
  const [selectedScriptId, setSelectedScriptId] = useState<string>(scripts[0]?.id || 'script-recordatorio-preventivo');
  const [scriptSearch, setScriptSearch] = useState<string>('');
  const [isCustomizingScript, setIsCustomizingScript] = useState<boolean>(false);

  // AI Agent Quality Evaluation State
  const [isEvaluatingAI, setIsEvaluatingAI] = useState<boolean>(false);
  const [aiEvaluation, setAiEvaluation] = useState<AIEvaluationResult | null>(null);
  const [showAIReviewDialog, setShowAIReviewDialog] = useState<boolean>(false);

  // Rescheduling Dialog State
  const [showRescheduleDialog, setShowRescheduleDialog] = useState<boolean>(false);
  const [rescheduleReason, setRescheduleReason] = useState<string>('Reprogramado por agente');

  // Validation state (Slide 6)
  const [validationReport, setValidationReport] = useState<{
    show: boolean;
    contactRecorded: boolean;
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
    authenticatedApiFetch(`/api/cliente360?cliente=${encodeURIComponent(client.code)}&pais=${countryParam}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const message = json?.error === 'UNAUTHORIZED'
            ? 'La sesión de la aplicación venció; vuelve a iniciar sesión y consulta SAN de nuevo.'
            : json?.message || json?.error || `Error al conectar con la API de SAN (HTTP ${res.status})`;
          throw new Error(message);
        }
        return json;
      })
      .then((json) => {
        if (!isMounted) return;
        if (json.success && json.data) {
          setSan360(json.data);

          const invoiceDataAvailable = json.data.invoiceDataAvailable === true;
          const invoiceBalancesComplete = json.data.invoiceBalancesComplete === true;
          const invoiceDebt = invoiceDataAvailable && invoiceBalancesComplete
            ? Number(json.data.summary?.pendientesMonto)
            : null;
          const realDebt = invoiceDebt !== null && Number.isFinite(invoiceDebt) ? invoiceDebt : null;
          const invoices: SanInvoice[] = Array.isArray(json.data.invoices) ? json.data.invoices : [];
          const pendingInvoices = invoices.filter((invoice) => {
            const outstanding = getSanInvoiceOutstanding(invoice);
            return (isPendingSanInvoice(invoice.estado) || isPartialSanInvoice(invoice.estado)) &&
              outstanding !== null && outstanding > 0.01;
          });
          let realDays: number | null = invoiceDataAvailable && invoiceBalancesComplete ? 0 : null;
          if (realDays !== null && pendingInvoices.length > 0) {
            const dueDates = pendingInvoices.map((invoice) =>
              invoice.fechavence ? new Date(invoice.fechavence.slice(0, 10)).getTime() : Number.NaN
            );
            if (dueDates.every(Number.isFinite)) {
              const nowMs = Date.now();
              const maxDiff = Math.max(
                0,
                ...dueDates.map((dueMs) => Math.floor((nowMs - dueMs) / 86400000))
              );
              realDays = Math.min(maxDiff, 365);
            } else {
              realDays = null;
            }
          }

          if (!invoiceDataAvailable) {
            setFetchError360('SAN devolvió el contexto, pero no el detalle de facturas; no se puede confirmar saldo ni marcar el lead como resuelto.');
          } else if (!invoiceBalancesComplete || realDebt === null) {
            setFetchError360('SAN devolvió facturas con saldos o estados sin validar; no se actualizó el saldo ni el estado del lead.');
          } else {
            setFetchError360(null);
          }

          const updates: Partial<Client> = {};
          if (realDebt !== null && Math.abs(realDebt - client.totalDebt) > 0.01) {
            updates.totalDebt = realDebt;
          }
          if (realDebt !== null && realDays !== null && client.debtVerified !== true) {
            updates.debtVerified = true;
          }
          if (realDays !== null && realDays !== client.daysArrears) {
            updates.daysArrears = realDays;
            updates.moraRange = realDays > 120 ? '120+' : realDays > 90 ? '91-120' : realDays > 60 ? '61-90' : realDays > 30 ? '31-60' : '0-30';
            updates.priority = realDays > 90 ? 'Alta' : realDays > 30 ? 'Media' : 'Normal';
          }
          if (realDebt !== null && realDebt <= 0.01 && client.state !== 'Resuelto') {
            updates.state = 'Resuelto';
          } else if (realDebt !== null && realDebt > 0.01 && client.state === 'Resuelto') {
            updates.state = 'Pendiente';
          }
          if (json.data.clientInfo?.CardName && json.data.clientInfo.CardName !== client.name) {
            updates.name = json.data.clientInfo.CardName;
          }

          if (json.data.clientInfo?.CATEGORIA && json.data.clientInfo.CATEGORIA !== client.classification) {
            updates.classification = json.data.clientInfo.CATEGORIA;
          }
          if (Object.keys(updates).length > 0 && onUpdateClientData) {
            onUpdateClientData(client.code, updates);
          }
        } else {
          setFetchError360(`No se pudo consultar SAN. Se mantienen los datos de cartera locales; no se confirmó el estado de pago. ${json.error || ''}`.trim());
        }
      })
      .catch((err) => {
        if (isMounted) {
          setFetchError360(`No se pudo consultar SAN. Se mantienen los datos de cartera locales; no se confirmó el estado de pago. ${err.message || 'Error de red'}`);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading360(false);
      });

    return () => {
      isMounted = false;
    };
  }, [client.code, client.country]);

  const currentSelectedScript =
    scripts.find((s) => s.id === selectedScriptId) || scripts[0] || INITIAL_MESSAGE_SCRIPTS[0];

  useEffect(() => {
    if (!isCustomizingScript && currentSelectedScript) {
      const rendered = replaceScriptVariables(currentSelectedScript.templateText, {
        ...client,
        contactPerson: client.contactPerson || san360?.clientInfo?.contactName,
        totalDebt: client.totalDebt || san360?.summary?.pendientesMonto,
      });
      setWhatsappMessage(rendered);
    }
  }, [selectedScriptId, client.code, client.totalDebt, client.contactPerson, san360?.clientInfo?.contactName, san360?.summary?.pendientesMonto, currentSelectedScript, isCustomizingScript]);

  useEffect(() => {
    const initialPhone = client.celular || client.phone1 || client.telefono || '';
    setTargetWhatsAppPhone(initialPhone);
  }, [client.code, client.celular, client.phone1, client.telefono]);

  const handleCopyWhatsApp = () => {
    navigator.clipboard?.writeText(whatsappMessage);
    setCopiedWhatsApp(true);
    setTimeout(() => setCopiedWhatsApp(false), 3000);
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

  // Safely extract options whether stored as array, JSON string, or comma-separated list
  const getFieldOptions = (field: DynamicField): string[] => {
    if (!field) return [];
    if (Array.isArray(field.options)) return field.options.map(String);
    if (typeof field.options === 'string') {
      try {
        const p = JSON.parse(field.options);
        if (Array.isArray(p)) return p.map(String);
      } catch {}
      return (field.options as string).split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  };

  const configuredFields: DynamicField[] =
    dynamicFields && dynamicFields.length > 0
      ? dynamicFields.filter((field) => field && field.isActive !== false).sort((a, b) => (a?.order || 0) - (b?.order || 0))
      : [
          { id: 'f-1', name: 'tipo_gestion', label: 'Tipo de Gestión', type: 'dropdown', options: ['Llamada', 'WhatsApp', 'Microsoft Teams', 'Email', 'Visita'], isRequired: true, order: 1, isActive: true },
          { id: 'f-2', name: 'contacto_exitoso', label: '¿Contacto exitoso?', type: 'dropdown', options: ['Sí', 'No', 'Sin respuesta'], isRequired: true, order: 2, isActive: true },
          { id: 'f-3', name: 'acuerdo', label: 'Acuerdo', type: 'dropdown', options: ['Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura'], isRequired: true, order: 3, isActive: true },
          { id: 'f-4', name: 'fecha_limite', label: 'Fecha límite de pago', type: 'date', isRequired: true, order: 4, isActive: true },
          { id: 'f-5', name: 'monto_comprometido', label: 'Monto comprometido ($)', type: 'money', isRequired: true, order: 5, isActive: true },
          { id: 'f-6', name: 'observaciones', label: 'Observaciones de la Gestión', type: 'textarea', isRequired: false, order: 6, isActive: true },
        ];
  const activeFields = configuredFields.filter((field) => {
    const name = String(field.name || '').trim().toLocaleLowerCase();
    const label = String(field.label || '').trim().toLocaleLowerCase();
    return ![
      'tipo_gestion',
      'contacto_exitoso',
      'acuerdo',
      'fecha_limite',
      'monto_comprometido',
      'observaciones',
    ].includes(name)
      && ![
        'tipo de gestión',
        '¿contacto exitoso?',
        'contacto exitoso',
        'acuerdo',
        'acuerdo alcanzado',
        'fecha límite de pago',
        'monto comprometido ($)',
        'observaciones de la gestión',
        'observaciones libres',
      ].includes(label);
  });

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

  const setAgreementDecision = (decision: 'Sí' | 'No') => {
    setIsPaymentOutcome(false);
    const nextAgreement = decision === 'Sí' ? 'Promesa de Pago' : 'Sin Acuerdo';
    setSuccessfulContact(decision);
    setAgreement(nextAgreement);
    setPaymentReceiptFile(null);
    setDynamicValues((previous) => ({
      ...previous,
      contacto_exitoso: decision,
      acuerdo: nextAgreement,
      paymentOutcome: undefined,
    }));
  };

  const setPaymentDecision = () => {
    setIsPaymentOutcome(true);
    setSuccessfulContact('Sí');
    setAgreement('Pago realizado');
    setPaymentDate(getElSalvadorDateKey());
    setDynamicValues((previous) => ({
      ...previous,
      contacto_exitoso: 'Sí',
      acuerdo: 'Pago realizado',
      paymentOutcome: 'payment_received',
    }));
  };

  const selectManagementChannel = (channel: string) => {
    setManagementType(channel);
    const tipoField = activeFields.find(
      (f) => f && (f.name === 'tipo_gestion' || (f.label || '').toLowerCase().includes('tipo de gest'))
    );
    if (tipoField) {
      setDynamicValues((prev) => ({ ...prev, [tipoField.name]: channel }));
    }
  };

  const missingRequiredDynamicField = activeFields.find((field) => {
    if (!field || !field.isRequired || field.isActive === false) return false;
    const value = resolveFieldValue(field);
    if (field.type === 'checkbox') {
      return !Array.isArray(value) || value.length === 0;
    }
    if (typeof value === 'string') {
      return value.trim() === '';
    }
    return value === undefined || value === null || value === '';
  });

  const isPromiseAgreement = agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas';
  const savedManagementChannel = managementType === 'Script Mensaje' ? 'WhatsApp' : managementType;
  const usesEmailForContact = savedManagementChannel === 'Email';
  const workflowStatus = isPaymentOutcome
    ? 'Resuelto'
    : successfulContact === 'Sí' ? 'Contactado' : 'Reprogramado';
  const parseMoneyAmount = (value: string) => {
    let normalized = String(value || '').trim().replace(/[^\d,.-]/g, '');
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

  const handleGuardarGestion = async () => {
    if (pbxCallRequiredMissing) {
      const errorMessage = pbxCallsLoading
        ? 'Espera a que termine la búsqueda de llamadas PBX y selecciona la llamada que corresponde.'
        : pbxSearchIsStale
          ? 'Cambiaste el teléfono o el rango de búsqueda. Pulsa “Buscar llamadas” y selecciona una llamada antes de guardar como llamada.'
          : 'Selecciona una llamada PBX verificada para guardar esta gestión como llamada. Si el contacto fue por otro canal, cambia a Correo o WhatsApp; las notas se conservan.';
      setValidationReport({
        show: true,
        contactRecorded: Boolean(successfulContact),
        mandatoryValid: Boolean(managementType && successfulContact),
        agreementValid: false,
        isSuccess: false,
        errorMessage,
      });
      return;
    }
    setIsSubmitting(true);

    const contactsToPersist = successfulContact === 'Sí'
      ? contactsToAdd.filter((contact) =>
          Boolean(contact.nombre.trim() || contact.telefono.trim() || contact.correo.trim() || contact.cargo.trim())
        )
      : [];
    const invalidContactIndex = contactsToPersist.findIndex((contact) => {
      const letters = contact.nombre.trim().replace(/[^a-záéíóúüñ]/gi, '').length;
      const phoneDigits = contact.telefono.replace(/\D/g, '');
      const emailIsValid = !contact.correo.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.correo.trim());
      return letters < 6 || phoneDigits.length < 8 || !emailIsValid || contact.cargo.trim().length > 120;
    });
    const phoneForContact = savedManagementChannel === 'WhatsApp'
      ? contactPhone.trim() || targetWhatsAppPhone.trim()
      : contactPhone.trim();
    const phoneDigits = phoneForContact.replace(/\D/g, '');
    const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
    const contactIsValid = usesEmailForContact ? emailIsValid : phoneDigits.length >= 8;
    const contactNameLetters = contactName.trim().replace(/[^a-záéíóúüñ]/gi, '').length;
    const amount = parseMoneyAmount(committedAmount);
    const contactMethodDetails = usesEmailForContact
      ? `por correo electrónico (${contactEmail.trim() || '[correo]'})`
      : savedManagementChannel === 'WhatsApp'
        ? `por WhatsApp al teléfono ${phoneForContact || '[número]'}`
        : `al teléfono ${phoneForContact || client.phone1 || client.celular || '[número]'}`;
    const agreementDetails = isPaymentOutcome
      ? `Pago reportado por ${paymentMadeBy.trim() || '[persona que realizó el pago]'} el ${paymentDate || '[fecha de pago]'}. Comprobante adjunto.`
      : successfulContact === 'Sí'
      ? [
          `Se contactó a ${client.name}.`,
          `Canal: ${savedManagementChannel}. Se habló con ${contactName.trim() || client.contactPerson || '[nombre de contacto]'} ${contactMethodDetails}.`,
          `Prometió pagar ${client.country === 'GT' ? 'Q' : '$'}${committedAmount || '[monto]'} el ${deadlineDate || '[fecha]'}${promiseTime ? ` a las ${promiseTime}` : ''}.`,
        ].join(' ')
      : '';
    const rescheduleIsInCurrentMonth = existingRecord
      ? Boolean(rescheduleDate || existingValues.rescheduleDate || existingValues.scheduledDate)
      : Boolean(rescheduleDate)
        && rescheduleDate >= todayKey
        && rescheduleDate >= currentMonthStart
        && rescheduleDate <= currentMonthEnd;
    const mandatoryValid = Boolean(managementType && successfulContact);
    const existingReceiptType = String(existingValues.paymentEvidenceMime || '');
    const existingReceiptSize = Number(existingValues.paymentEvidenceSize);
    const existingReceiptValid = Boolean(
      existingPaymentReceiptPath
      && PAYMENT_RECEIPT_TYPES.has(existingReceiptType)
      && Number.isInteger(existingReceiptSize)
      && existingReceiptSize > 0
      && existingReceiptSize <= MAX_PAYMENT_RECEIPT_BYTES
    );
    const receiptTypeValid = Boolean(
      paymentReceiptFile
        ? PAYMENT_RECEIPT_TYPES.has(paymentReceiptFile.type)
        : existingReceiptValid
    );
    const receiptSizeValid = Boolean(
      paymentReceiptFile
        ? paymentReceiptFile.size <= MAX_PAYMENT_RECEIPT_BYTES
        : existingReceiptValid
    );
    const paymentDateValid = /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) && paymentDate <= todayKey;
    const agreementValid = isPaymentOutcome
      ? canRecordPaid
        && paymentDateValid
        && paymentMadeBy.trim().length >= 2
        && receiptTypeValid
        && receiptSizeValid
      : successfulContact === 'Sí'
      ? isPromiseAgreement && (
          contactNameLetters > 5 &&
          contactIsValid &&
          Boolean(deadlineDate) &&
          Number.isFinite(amount) &&
          amount > 0
        )
      : successfulContact === 'No'
        ? rescheduleIsInCurrentMonth
        : false;
    const reasons: string[] = [];
    if (!mandatoryValid) reasons.push('Selecciona el resultado de la gestión.');
    if (isPaymentOutcome && !canRecordPaid) {
      reasons.push(`Pago realizado solo se habilita cuando SAN está verificado y el saldo pendiente del mes actual es ${formatSanCurrency(0, client.country)}.`);
    }
    if (isPaymentOutcome && !paymentDateValid) reasons.push('Selecciona una fecha de pago válida, no futura.');
    if (isPaymentOutcome && paymentMadeBy.trim().length < 2) reasons.push('Indica quién realizó el pago.');
    if (isPaymentOutcome && !receiptTypeValid) reasons.push('Adjunta un comprobante en PDF, JPG, PNG, WEBP o GIF.');
    if (isPaymentOutcome && !receiptSizeValid) reasons.push('El comprobante no puede superar 50 MB.');
    if (successfulContact === 'Sí' && !isPromiseAgreement && !isPaymentOutcome) reasons.push('Completa el formulario de promesa de pago.');
    if (successfulContact === 'Sí' && isPromiseAgreement) {
      if (contactNameLetters <= 5) reasons.push('El nombre de contacto debe tener más de 5 letras.');
      if (usesEmailForContact && !emailIsValid) reasons.push('Ingresa un correo electrónico válido para el contacto.');
      if (!usesEmailForContact && phoneDigits.length < 8) reasons.push('El teléfono debe tener al menos 8 dígitos.');
      if (!deadlineDate) reasons.push('Selecciona la fecha de promesa.');
      if (!Number.isFinite(amount) || amount <= 0) reasons.push('Ingresa un monto válido mayor a cero.');
    }
    if (successfulContact === 'No' && !rescheduleIsInCurrentMonth) {
      reasons.push(`Selecciona una fecha futura dentro de ${currentMonthLabel}.`);
    }
    if (invalidContactIndex >= 0) {
      reasons.push(`Revisa el contacto nuevo ${invalidContactIndex + 1}: nombre de al menos 6 letras, teléfono de 8 dígitos, correo válido y cargo de máximo 120 caracteres.`);
    }
    const isSuccess = mandatoryValid && agreementValid && invalidContactIndex < 0;
    const errorMessage = reasons.join(' ');

    const report = {
      show: true,
      contactRecorded: Boolean(successfulContact),
      mandatoryValid,
      agreementValid,
      isSuccess,
      errorMessage,
    };

    setValidationReport(report);

    if (!isSuccess) {
      setIsSubmitting(false);
      return;
    }

    // No-contact outcomes need no semantic review; successful contact must receive a real API verdict.
    setIsEvaluatingAI(true);
    let aiVerdictResult: AIEvaluationResult | null = null;

    try {
    if (!existingRecord && successfulContact === 'Sí' && !isPaymentOutcome) {
        const res = await fetch('/api/evaluar-gestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientCode: client.code,
            clientName: client.name,
            totalDebt: client.totalDebt || 0,
            daysArrears: client.daysArrears || 0,
            managementType: savedManagementChannel,
            successfulContact,
            agreement,
            deadlineDate,
            promiseTime,
            contactName,
            contactPhone: usesEmailForContact ? '' : phoneForContact,
            contactEmail,
            contactChannel: savedManagementChannel,
            committedAmount: amount,
            agreementDetails,
            observations,
            dynamicValues: {
              ...dynamicValues,
              agreementDetails,
              contactName,
              contactPhone: usesEmailForContact ? undefined : phoneForContact,
              contactEmail: usesEmailForContact ? contactEmail : undefined,
              contactChannel: savedManagementChannel,
              promiseTime,
            },
          }),
        });
        if (!res.ok) throw new Error('El evaluador no está disponible.');
        const data = await res.json();
        if (!data?.evaluation || typeof data.evaluation.isValid !== 'boolean') {
          throw new Error('El evaluador no devolvió un resultado verificable.');
        }
        aiVerdictResult = data.evaluation;
      }
    } catch (e) {
      console.warn('No fue posible validar la gestión con el evaluador:', e);
      setValidationReport({
        show: true,
        contactRecorded: true,
        mandatoryValid: true,
        agreementValid: true,
        isSuccess: false,
        errorMessage: 'No se pudo verificar la gestión. No se guardó; intenta de nuevo cuando el evaluador esté disponible.',
      });
      return;
    } finally {
      setIsEvaluatingAI(false);
      setIsSubmitting(false);
    }

    setAiEvaluation(aiVerdictResult);

    // If AI deems the gestión invalid, ask the agent to fix it or reschedule
    if (aiVerdictResult && !aiVerdictResult.isValid) {
      setShowAIReviewDialog(true);
      return;
    }

    let paymentEvidencePath: string | undefined = isPaymentOutcome
      ? existingPaymentReceiptPath || undefined
      : undefined;
    if (isPaymentOutcome && paymentReceiptFile) {
      setIsSubmitting(true);
      try {
        const extensionByType: Record<string, string> = {
          'application/pdf': 'pdf',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
          'image/gif': 'gif',
        };
        const safeCode = client.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
        const agentPathId = (activeAgent?.id || currentUser.id).replace(/[^a-zA-Z0-9-]/g, '');
        paymentEvidencePath = `${client.country}/${safeCode}/${agentPathId}/${crypto.randomUUID()}.${extensionByType[paymentReceiptFile.type]}`;
        const { error } = await supabase.storage
          .from(PAYMENT_RECEIPT_BUCKET)
          .upload(paymentEvidencePath, paymentReceiptFile, {
            upsert: false,
            contentType: paymentReceiptFile.type,
          });
        if (error) throw error;
      } catch {
        setIsSubmitting(false);
        setValidationReport({
          show: true,
          contactRecorded: true,
          mandatoryValid: true,
          agreementValid: true,
          isSuccess: false,
          errorMessage: 'No se pudo subir el comprobante. Revisa el formato, el límite de 50 MB y los permisos de almacenamiento.',
        });
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

    if (contactsToPersist.length > 0) {
      setIsSubmitting(true);
      try {
        const response = await authenticatedApiFetch('/api/contactos-cobros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pais: client.country,
            codigo_cliente: client.code,
            contactos: contactsToPersist,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success || !Array.isArray(payload.contactos)) {
          throw new Error('No se pudieron guardar los contactos nuevos.');
        }
        const savedContacts = payload.contactos as ContactoCobros[];
        setCobrosContacts((existing) =>
          [...existing, ...savedContacts].sort((left, right) => left.numero_contacto - right.numero_contacto)
        );
        setContactsToAdd([]);
      } catch {
        setIsSubmitting(false);
        setValidationReport({
          show: true,
          contactRecorded: true,
          mandatoryValid: true,
          agreementValid: true,
          isSuccess: false,
          errorMessage: 'No se guardó la gestión porque no se pudieron guardar los contactos nuevos. Revisa la conexión e inténtalo de nuevo.',
        });
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

    // Build new management history item with exact timestamp
    const exactDate = new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
    const exactTime = new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isoTimestamp = new Date().toISOString();
    const recordsPromise = successfulContact === 'Sí' && isPromiseAgreement;
    const pbxCallForRecord = managementType === 'Llamada' ? selectedPbxCall : null;
    const finalAgreement = isPaymentOutcome ? 'Pago realizado' : successfulContact === 'Sí' ? agreement : 'Sin Acuerdo';
    const finalAgreementDetails = agreementDetails;
    const finalObservations = observations.trim();
    const scheduledForDate = pbxCallForRecord?.callDate
      || existingRecord?.scheduledForDate
      || String(existingValues.scheduledForDate || '')
      || client.portfolioDateForGestion
      || client.scheduledDate
      || (client.scheduledDay && client.scheduledDay >= 1 && client.scheduledDay <= 22
        ? `${todayKey.slice(0, 7)}-${String(client.scheduledDay).padStart(2, '0')}`
        : todayKey);
    const pbxCallTimestamp = pbxCallForRecord
      ? Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(pbxCallForRecord.dateTime)
          ? pbxCallForRecord.dateTime
          : `${pbxCallForRecord.dateTime.replace(' ', 'T')}-06:00`)
      : Number.NaN;
    const transcriptAvailableAfter = Number.isFinite(pbxCallTimestamp)
      ? new Date(pbxCallTimestamp + 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const dynamicValuesWithoutSubmissionId = {
      ...dynamicValues,
      tipo_gestion: savedManagementChannel,
      contactChannel: successfulContact === 'Sí' ? savedManagementChannel : undefined,
      scheduledForDate,
      periodMonth: isPaymentOutcome
        ? existingRecord?.agreement === 'Pago realizado'
          ? String(existingValues.periodMonth || currentMonthKey)
          : currentMonthKey
        : scheduledForDate.slice(0, 7),
      contactName: recordsPromise ? contactName.trim() : undefined,
      contactPhone: recordsPromise && !usesEmailForContact ? phoneForContact : undefined,
      contactEmail: recordsPromise && usesEmailForContact ? contactEmail.trim() : undefined,
      promiseTime: recordsPromise ? promiseTime || undefined : undefined,
      agreementDetails: finalAgreementDetails || undefined,
      rescheduleDate: successfulContact === 'Sí' ? undefined : rescheduleDate,
      paymentOutcome: isPaymentOutcome ? 'payment_received' : undefined,
      paymentDate: isPaymentOutcome ? paymentDate : undefined,
      paymentMadeBy: isPaymentOutcome ? paymentMadeBy.trim() : undefined,
      paymentEvidencePath,
      paymentEvidenceName: isPaymentOutcome
        ? paymentReceiptFile?.name || existingValues.paymentEvidenceName
        : undefined,
      paymentEvidenceMime: isPaymentOutcome
        ? paymentReceiptFile?.type || existingValues.paymentEvidenceMime
        : undefined,
      paymentEvidenceSize: isPaymentOutcome
        ? paymentReceiptFile?.size || existingValues.paymentEvidenceSize
        : undefined,
      pbxCall: pbxCallForRecord
        ? {
            uniqueId: pbxCallForRecord.callId,
            extension: pbxCallForRecord.extension,
            username: pbxCallForRecord.username,
            date: pbxCallForRecord.callDate,
            dateTime: pbxCallForRecord.dateTime,
            origin: pbxCallForRecord.origin,
            destination: pbxCallForRecord.destination,
            durationSeconds: pbxCallForRecord.durationSeconds,
            state: pbxCallForRecord.state,
            recordingFile: pbxCallForRecord.recordingFile,
            searchedPhone: appliedPbxDestinationPhone,
          }
        : managementType === 'Llamada' ? existingPbxCall || undefined : undefined,
      pbxTranscriptReview: pbxCallForRecord
        ? currentPbxTranscriptReview?.status === 'ready_for_review'
          && currentPbxTranscriptReview.sourceCallId === pbxCallForRecord.callId
          ? currentPbxTranscriptReview
          : {
              status: 'pending',
              availableAfter: transcriptAvailableAfter,
            }
        : managementType === 'Llamada' ? existingValues.pbxTranscriptReview : undefined,
    };
    const recordedAmount = recordsPromise && Number.isFinite(amount) ? amount : undefined;
    const submissionSignature = JSON.stringify({
      country: client.country,
      clientCode: client.code,
      scheduledForDate,
      channel: savedManagementChannel,
      contactSuccess: successfulContact,
      agreement: finalAgreement,
      committedAmount: recordedAmount ?? null,
      deadlineDate: recordsPromise ? deadlineDate || null : null,
      promiseTime: recordsPromise ? promiseTime || null : null,
      contactName: recordsPromise ? contactName.trim() : '',
      contactPhone: recordsPromise && !usesEmailForContact ? phoneForContact : '',
      contactEmail: recordsPromise && usesEmailForContact ? contactEmail.trim() : '',
      observations: finalObservations,
      dynamicValues: dynamicValuesWithoutSubmissionId,
      pbxCallId: pbxCallForRecord?.callId || null,
      paymentEvidencePath: paymentEvidencePath || null,
    });
    let sourceRecordId: string;
    if (existingRecord) {
      sourceRecordId = String(existingValues.localAuditId || existingRecord.id);
    } else if (pbxCallForRecord) {
      sourceRecordId = `pbx-${client.country}-${client.code}-${pbxCallForRecord.callId}`
        .replace(/[^A-Za-z0-9_-]/g, '_');
    } else if (pendingSubmissionId.current?.signature === submissionSignature) {
      sourceRecordId = pendingSubmissionId.current.id;
    } else {
      sourceRecordId = createAuditSubmissionId();
      pendingSubmissionId.current = { signature: submissionSignature, id: sourceRecordId };
    }
    const finalDynamicValues = {
      ...dynamicValuesWithoutSubmissionId,
      localAuditId: sourceRecordId,
    };
    const newHistoryItem: ClientManagementHistoryItem = {
      id: existingRecord?.id || `hist-${sourceRecordId}`,
      date: existingRecord?.date || exactDate,
      scheduledForDate,
      time: existingRecord?.time || exactTime,
      channel: savedManagementChannel,
      callRound: client.callRound || 1,
      callRoundLabel: existingRecord?.callRoundLabel || client.callRoundLabel || '1ª Llamada (Programada)',
      contactSuccess: successfulContact,
      agreement: finalAgreement,
      committedAmount: recordedAmount,
      deadlineDate: recordsPromise ? deadlineDate || undefined : undefined,
      promiseTime: recordsPromise ? promiseTime || undefined : undefined,
      durationSeconds: pbxCallForRecord?.durationSeconds || existingRecord?.durationSeconds,
      contactName: recordsPromise ? contactName.trim() : undefined,
      contactPhone: recordsPromise && !usesEmailForContact ? phoneForContact : undefined,
      contactEmail: recordsPromise && usesEmailForContact ? contactEmail.trim() : undefined,
      observations: [finalAgreementDetails, finalObservations].filter(Boolean).join('\n\n'),
      agentName: managementAgentName,
      status: workflowStatus as any,
      aiVerdict: existingRecord?.aiVerdict || 'Válida',
      aiScore: aiVerdictResult?.score ?? existingRecord?.aiScore,
      dynamicValues: finalDynamicValues,
    };

    const newAuditRecord: GestionAuditRecord = {
      id: existingRecord?.id || sourceRecordId,
      timestamp: existingRecord?.timestamp || isoTimestamp,
      date: existingRecord?.date || exactDate,
      scheduledForDate,
      time: existingRecord?.time || exactTime,
      agentId: managementAgentId,
      agentName: managementAgentName,
      pbxExtension: activeAgent?.pbxExtension || undefined,
      clientCode: client.code,
      clientName: client.name,
      country: client.country,
      channel: savedManagementChannel,
      durationSeconds: pbxCallForRecord?.durationSeconds || existingRecord?.durationSeconds,
      contactSuccess: successfulContact,
      agreement: finalAgreement,
      committedAmount: recordedAmount,
      deadlineDate: recordsPromise ? deadlineDate || undefined : undefined,
      promiseTime: recordsPromise ? promiseTime || undefined : undefined,
      contactName: recordsPromise ? contactName.trim() : undefined,
      contactPhone: recordsPromise && !usesEmailForContact ? phoneForContact : undefined,
      contactEmail: recordsPromise && usesEmailForContact ? contactEmail.trim() : undefined,
      observations: [finalAgreementDetails, finalObservations].filter(Boolean).join('\n\n'),
      aiVerdict: existingRecord?.aiVerdict || 'Válida',
      aiScore: aiVerdictResult?.score ?? existingRecord?.aiScore,
      totalDebt: client.totalDebt,
      callRoundLabel: existingRecord?.callRoundLabel || client.callRoundLabel || '1ª Llamada (Programada)',
      dynamicValues: finalDynamicValues,
      status: workflowStatus as any,
    };

    const agentFacingHistoryItem: ClientManagementHistoryItem = isPaymentOutcome
      ? {
          ...newHistoryItem,
          observations: '',
          committedAmount: undefined,
          contactName: undefined,
          contactPhone: undefined,
          contactEmail: undefined,
          aiVerdict: 'Válida',
          dynamicValues: {
            scheduledForDate,
            periodMonth: finalDynamicValues.periodMonth,
            paymentOutcome: 'payment_received',
            summaryOnly: true,
            pbxCall: finalDynamicValues.pbxCall,
            pbxTranscriptReview: finalDynamicValues.pbxTranscriptReview,
          },
        }
      : newHistoryItem;
    const agentFacingAuditRecord: GestionAuditRecord = isPaymentOutcome
      ? {
          ...newAuditRecord,
          observations: '',
          committedAmount: undefined,
          contactName: undefined,
          contactPhone: undefined,
          contactEmail: undefined,
          dynamicValues: {
            scheduledForDate,
            periodMonth: finalDynamicValues.periodMonth,
            paymentOutcome: 'payment_received',
            summaryOnly: true,
            pbxCall: finalDynamicValues.pbxCall,
            pbxTranscriptReview: finalDynamicValues.pbxTranscriptReview,
          },
        }
      : newAuditRecord;
    const updatedHistory = [agentFacingHistoryItem, ...(client.managementHistory || [])];

    // Record into Supabase database
    let pbxCallOmitted = false;
    try {
      if (existingRecord) {
        const response = await authenticatedApiFetch('/api/cartera?action=editar-gestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: existingRecord.id,
            pais: client.country,
            codigo_cliente: client.code,
            tipo_gestion: savedManagementChannel,
            contacto_exitoso: successfulContact,
            acuerdo: finalAgreement,
            fecha_limite_pago: recordsPromise ? deadlineDate : null,
            monto_comprometido: recordedAmount || 0,
            observaciones: [finalAgreementDetails, finalObservations].filter(Boolean).join('\n\n'),
            duracion_llamada_segundos: pbxCallForRecord?.durationSeconds
              ?? existingRecord.durationSeconds
              ?? null,
            valores_dinamicos: finalDynamicValues,
            validacion_exitosa: existingRecord.aiVerdict !== 'Inválida',
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success || payload.id !== existingRecord.id) {
          throw new Error(payload.message || 'El servidor no confirmó la actualización de esta gestión.');
        }
      } else if (isPaymentOutcome) {
        const response = await authenticatedApiFetch('/api/cartera?action=pago-realizado', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pais: client.country,
            codigo_cliente: client.code,
            mes: currentMonthKey,
            fecha_pago: paymentDate,
            persona_pago: paymentMadeBy.trim(),
            tipo_gestion: savedManagementChannel,
            observaciones: finalObservations,
            fecha_agenda: scheduledForDate,
            valores_dinamicos: finalDynamicValues,
            comprobante: {
              path: paymentEvidencePath,
              nombre: paymentReceiptFile?.name,
              tipo: paymentReceiptFile?.type,
              tamano: paymentReceiptFile?.size,
            },
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || 'No se pudo registrar el pago.');
        }
        pbxCallOmitted = payload.pbxCallOmitted === true;
      } else {
        const response = await authenticatedApiFetch('/api/cartera?action=sync-gestiones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pais: client.country,
            mode: 'commit',
            source: 'live',
            records: [agentFacingAuditRecord],
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || 'No se pudo guardar la gestión en el servidor.');
        }
        pbxCallOmitted = Number(payload.pbxCallOmittedCount || 0) > 0;
        if (Number(payload.importedCount || 0) === 0 && Number(payload.alreadyPresentCount || 0) === 0) {
          throw new Error('El servidor no guardó esta gestión; el cliente sigue pendiente. Revisa que pertenezca a tu cartera y vuelve a intentarlo.');
        }
      }
    } catch (err) {
      if (paymentEvidencePath) {
        await supabase.storage.from(PAYMENT_RECEIPT_BUCKET).remove([paymentEvidencePath]).catch(() => undefined);
      }
      if (isPaymentOutcome) {
        setIsSubmitting(false);
        setValidationReport({
          show: true,
          contactRecorded: true,
          mandatoryValid: true,
          agreementValid: true,
          isSuccess: false,
          errorMessage: err instanceof Error ? err.message : 'No se pudo guardar el pago; no se marcó como resuelto.',
        });
        return;
      }
      setIsSubmitting(false);
      const syncError = err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'error de sincronización';
      const sessionExpired = /sesión|session|unauthorized/i.test(syncError);
      setValidationReport({
        show: true,
        contactRecorded: true,
        mandatoryValid: true,
        agreementValid: true,
        isSuccess: false,
        errorMessage: sessionExpired
          ? `La sesión venció y el servidor no guardó la gestión. Inicia sesión de nuevo y vuelve a registrar; no se marcó como completada. Detalle: ${syncError}`
          : `No se guardó la gestión en la bitácora del servidor: ${syncError}. No se marcó como completada.`,
      });
      return;
    }

    if (pbxCallOmitted) {
      const savedValuesWithoutPbxCall = {
        ...finalDynamicValues,
        pbxCall: undefined,
        pbxTranscriptReview: undefined,
      };
      newHistoryItem.dynamicValues = savedValuesWithoutPbxCall;
      newAuditRecord.dynamicValues = savedValuesWithoutPbxCall;
      newHistoryItem.durationSeconds = undefined;
      newAuditRecord.durationSeconds = undefined;
      if (agentFacingHistoryItem !== newHistoryItem) {
        agentFacingHistoryItem.dynamicValues = savedValuesWithoutPbxCall;
        agentFacingHistoryItem.durationSeconds = undefined;
      }
      if (agentFacingAuditRecord !== newAuditRecord) {
        agentFacingAuditRecord.dynamicValues = savedValuesWithoutPbxCall;
        agentFacingAuditRecord.durationSeconds = undefined;
      }
    }

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'],
    });

    onSaveGestionSuccess(
      client.code,
      {
        state: workflowStatus as any,
        lastManagementDate: `${new Date().getDate()}/${new Date().toLocaleString('es', { month: 'short' })} - ${savedManagementChannel}`,
        lastManagementType: savedManagementChannel,
        managementHistory: updatedHistory,
        ...(successfulContact === 'Sí' ? {
          scheduledDate: undefined,
          scheduledDay: undefined,
        } : {
          scheduledDate: rescheduleDate,
          scheduledDay: Number(rescheduleDate.slice(8, 10)),
          callRound: (client.callRound || 1) + 1,
          callRoundLabel: `${(client.callRound || 1) + 1}ª Llamada (Reprogramada)`,
        }),
      },
      agentFacingAuditRecord
    );
  };

  // Safe data accessors from real SAN response
  const clientInfo = san360?.clientInfo;
  const anexosData = san360?.anexosData;
  const rawInvoices: SanInvoice[] = san360?.invoices || [];
  const claims = reclamosSla;
  const payments = san360?.payments || [];
  const equipment = san360?.equipment || [];
  const invoiceDataVerified =
    san360?.invoiceDataAvailable === true && san360?.invoiceBalancesComplete === true;
  const canRecordPaid =
    existingRecord?.agreement === 'Pago realizado'
    || (invoiceDataVerified && Number(san360?.summary?.mesPendientesMonto) <= 0.01);

  const rawPendientes = rawInvoices.filter((invoice) => {
    const outstanding = getSanInvoiceOutstanding(invoice);
    return (isPendingSanInvoice(invoice.estado) || isPartialSanInvoice(invoice.estado)) &&
      outstanding !== null && outstanding > 0.01;
  });
  const rawPagadas = rawInvoices.filter((invoice) => isPaidSanInvoice(invoice.estado));

  const rawPendientesCount = rawPendientes.length;
  const rawPendientesMonto = rawPendientes.reduce((total, invoice) => total + (getSanInvoiceOutstanding(invoice) || 0), 0);
  const rawPagadasCount = rawPagadas.length;
  const rawPagadasMonto = rawPagadas.reduce((a, b) => a + (parseFloat(b.valordoc) || 0), 0);
  const rawTotalMonto = rawInvoices
    .filter((invoice) => !isVoidedSanInvoice(invoice.estado))
    .reduce((a, b) => a + (parseFloat(b.valordoc) || 0), 0);

  const fallbackDebt = client.totalDebt || 0;
  const currentMonthParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const currentMonthKey =
    `${currentMonthParts.find((part) => part.type === 'year')?.value}-` +
    `${currentMonthParts.find((part) => part.type === 'month')?.value}`;
  const currentMonthInvoices = rawInvoices.filter(
    (invoice) =>
      !isVoidedSanInvoice(invoice.estado) &&
      (
        (invoice.fechaEmision || '').startsWith(currentMonthKey) ||
        (invoice.fechavence || '').startsWith(currentMonthKey)
      )
  );
  const currentMonthAmount = invoiceDataVerified
    ? Number(san360?.summary?.mesEmitidasMonto) || 0
    : currentMonthInvoices.reduce((total, invoice) => total + (parseSanAmount(invoice.valordoc) || 0), 0);
  const currentMonthCount = invoiceDataVerified
    ? Number(san360?.summary?.mesEmitidasCount) || 0
    : currentMonthInvoices.length;

  const summary = san360?.summary || {
    totalEmitidasCount: rawInvoices.length,
    totalEmitidasMonto: rawTotalMonto,
    pagadasCount: rawPagadasCount,
    pagadasMonto: rawPagadasMonto,
    pendientesCount: rawPendientesCount,
    pendientesMonto: rawPendientesMonto,
    mesEmitidasCount: currentMonthCount,
    mesEmitidasMonto: currentMonthAmount,
    mesPagadasCount: 0,
    mesPagadasMonto: 0,
    mesPendientesCount: 0,
    mesPendientesMonto: currentMonthAmount,
    claimsCount: claims.length,
  };
  const displayedDebt = invoiceDataVerified
    ? Number(summary.pendientesMonto) || 0
    : fallbackDebt > 0 ? fallbackDebt : null;
  const displayedPendingCount = invoiceDataVerified ? Number(summary.pendientesCount) || 0 : null;

  // Sort invoices with outstanding balances first, including partial payments.
  const sortedInvoices = [...rawInvoices].sort((a, b) => {
    const aOutstanding = getSanInvoiceOutstanding(a);
    const bOutstanding = getSanInvoiceOutstanding(b);
    const aPend = aOutstanding === null || aOutstanding > 0.01;
    const bPend = bOutstanding === null || bOutstanding > 0.01;
    if (aPend && !bPend) return -1;
    if (!aPend && bPend) return 1;
    return (b.fechaEmision || '').localeCompare(a.fechaEmision || '');
  });

  // Filtered invoices for inline tab preview
  const displayInvoices = (sortedInvoices || []).filter((inv) => {
    if (!inv) return false;
    if (!invoiceSearch.trim()) return true;
    const term = (invoiceSearch || '').toLowerCase();
    return (
      String(inv.numdoc || '').toLowerCase().includes(term) ||
      String(inv.DocEntry || '').toLowerCase().includes(term) ||
      String(inv.num_control || '').toLowerCase().includes(term) ||
      String(inv.tipodoc || '').toLowerCase().includes(term)
    );
  });

  // Filtered claims for inline tab preview
  const filteredClaims = (claims || []).filter((clm) => {
    if (!clm) return false;
    const closed = isClosedClaim(clm.estado);
    if (claimsFilter === 'FINALIZADOS' && !closed) return false;
    if (claimsFilter === 'ABIERTOS' && closed) return false;
    if (claimsSearch.trim()) {
      const term = claimsSearch.trim().toLowerCase();
      const category = typeof clm.categoria === 'string'
        ? clm.categoria
        : clm.categoria?.nombre || clm.categoria?.categoria || clm.categoria?.name || clm.categoria?.label;
      const searchText = [
        clm.case_id,
        clm.estado,
        clm.tipo,
        clm.asunto,
        clm.descripcion,
        clm.resolucion,
        category,
        clm.fecha_creacion,
        clm.agente?.nombre,
      ].join(' ').toLowerCase();
      return searchText.includes(term);
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
                  Facturación y pagos desde SAN; cartera asignada desde SAP
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                  invoiceDataVerified
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    invoiceDataVerified ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}></span>
                  {invoiceDataVerified ? 'SAN verificado' : 'SAN por validar'}
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
                  <span>{fetchError360}</span>
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
                          {displayedDebt === null ? '—' : formatSanCurrency(displayedDebt, client.country)}
                        </div>
                        <span className="text-[10px] text-red-300/90 font-medium">
                          {displayedPendingCount === null
                            ? 'Saldo pendiente de confirmar en SAN'
                            : `${displayedPendingCount} ${displayedPendingCount === 1 ? 'pendiente' : 'pendientes'}`}
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-red-900/40 flex items-center justify-between text-[10px] text-red-400/80 font-medium">
                        <span>{invoiceDataVerified ? 'Saldo SAN' : 'Saldo de cartera'}</span>
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
                          {invoiceDataVerified ? formatSanCurrency(summary.pagadasMonto, client.country) : '—'}
                        </div>
                        <span className="text-[10px] text-emerald-300/90 font-medium">
                          {invoiceDataVerified ? `${Number(summary.pagadasCount) || 0} canceladas` : 'No verificado por SAN'}
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
                          {invoiceDataVerified ? formatSanCurrency(summary.totalEmitidasMonto, client.country) : '—'}
                        </div>
                        <span className="text-[10px] text-blue-300/90 font-medium">
                          {invoiceDataVerified ? `${Number(summary.totalEmitidasCount) || 0} facturas` : 'No verificado por SAN'}
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
                          {invoiceDataVerified ? formatSanCurrency(currentMonthAmount, client.country) : '—'}
                        </div>
                        <span className="text-[10px] text-purple-300/90 font-medium">
                          {invoiceDataVerified
                            ? `${currentMonthCount} ${currentMonthCount === 1 ? 'factura' : 'facturas'}`
                            : 'No verificado por SAN'}
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-purple-900/40 flex items-center justify-between text-[10px] text-purple-400/80 font-medium">
                         <span>{currentMonthLabel}</span>
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
                            const invoiceOutstanding = getSanInvoiceOutstanding(inv);
                            const isAnulada = isVoidedSanInvoice(inv.estado);
                            const isPagado = !isAnulada && invoiceOutstanding !== null && invoiceOutstanding <= 0.01;
                            const isMes =
                              (inv.fechaEmision || '').startsWith(currentMonthKey) ||
                              (inv.fechavence || '').startsWith(currentMonthKey);
                            const valor = parseFloat(inv.valordoc) || 0;
                            const pdfUrl = inv.url ? `https://san.red.com.sv/${inv.url}` : null;

                            return (
                              <div
                                key={inv.DocEntry || inv.DOCENTRY || idx}
                                className={`p-2.5 hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-2 ${
                                  !isPagado && !isAnulada ? 'bg-red-950/15' : ''
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
                                    {isAnulada ? (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700/70 text-slate-300">
                                        ANULADO
                                      </span>
                                    ) : isPagado ? (
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
                                    {inv.Fecha_aplica_pago && isPagado && ` • Pagado: ${String(inv.Fecha_aplica_pago).split(' ')[0]}`}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="text-right font-mono">
                                    <div className="font-extrabold text-white">
                                      {formatSanCurrency(valor, client.country)}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      IVA: {formatSanCurrency(inv.VatSum, client.country)}
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
                    {/* Contactos de cobros importados desde la plantilla regional */}
                    <div className="rounded-xl p-3.5 bg-slate-900/80 border border-slate-800 space-y-3">
                      <div className="font-bold text-slate-300 uppercase tracking-wider text-[11px] border-b border-slate-800/80 pb-1.5 flex items-center justify-between">
                        <span>Contactos de cobros</span>
                        <span className="text-slate-500 font-mono normal-case">
                          {client.country} · {client.code}
                        </span>
                      </div>

                      {requiresSupabaseAuth && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-200">
                          El acceso a teléfonos y correos requiere una sesión autenticada de Supabase. El inicio de sesión de pruebas actual es local y todavía no habilita esa lectura.
                        </div>
                      )}

                      {cobrosContactsError && (
                        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-200">
                          {cobrosContactsError}
                        </div>
                      )}

                      {isLoadingCobrosContacts ? (
                        <p className="text-[11px] text-slate-400">Cargando contactos de cobros…</p>
                      ) : (
                        <>
                          {cobrosClientInfo && (
                            <div className="flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
                                Entrega quedan: {cobrosClientInfo.entrega_quedan === null ? 'Sin dato' : cobrosClientInfo.entrega_quedan ? 'Sí' : 'No'}
                              </span>
                              <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
                                Factura física: {cobrosClientInfo.exige_factura_fisica === null ? 'Sin dato' : cobrosClientInfo.exige_factura_fisica ? 'Sí' : 'No'}
                              </span>
                            </div>
                          )}

                          {cobrosClientInfo?.procedimientos_cobro?.length ? (
                            <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-2.5">
                              <span className="text-[10px] text-slate-400 block uppercase font-medium mb-1">Procedimiento de cobros</span>
                              <ul className="space-y-1 text-[11px] text-slate-200">
                                {cobrosClientInfo.procedimientos_cobro.map((procedure, index) => (
                                  <li key={`${index}-${procedure}`} className="leading-snug">• {procedure}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {cobrosContacts.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              {cobrosContacts.map((contact) => {
                                const phone = contact.telefono_fijo?.replace(/\D/g, '') || '';
                                const whatsapp = contact.whatsapp?.replace(/\D/g, '') || '';

                                return (
                                  <div key={contact.id} className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-2.5 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <span className="font-semibold text-slate-100 block truncate">
                                          {contact.nombre || 'Contacto sin nombre'}
                                        </span>
                                        {contact.cargo && (
                                          <span className="text-[10px] text-slate-400 block truncate">{contact.cargo}</span>
                                        )}
                                      </div>
                                      <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                                        Contacto {contact.numero_contacto}
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5">
                                      {contact.telefono_fijo && (
                                        <a
                                          href={`tel:${phone}`}
                                          className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                                        >
                                          <Phone className="w-3 h-3" />
                                          {contact.telefono_fijo}
                                        </a>
                                      )}
                                      {contact.whatsapp && (
                                        <a
                                          href={`https://wa.me/${whatsapp}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                                        >
                                          <MessageCircle className="w-3 h-3" />
                                          WhatsApp: {contact.whatsapp}
                                        </a>
                                      )}
                                      {contact.correo && (
                                        <a
                                          href={`mailto:${contact.correo}`}
                                          className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-1 text-[10px] text-purple-300 hover:bg-purple-500/20"
                                        >
                                          <Mail className="w-3 h-3" />
                                          {contact.correo}
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : !requiresSupabaseAuth && !cobrosContactsError ? (
                            <p className="text-[11px] text-slate-500">
                              No hay contactos de cobros cargados para este código y país.
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>

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
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                      <p className="text-[10px] text-slate-400">
                        Abrí el formulario oficial de SAC y, al terminar, actualizá para verificar el reclamo desde su API.
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={SAC_NEW_CASE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-blue-500"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir reclamo
                        </a>
                        <button
                          type="button"
                          onClick={() => void loadReclamosSla(true)}
                          disabled={isLoadingReclamosSla}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${isLoadingReclamosSla ? 'animate-spin' : ''}`} />
                          {isLoadingReclamosSla ? 'Consultando…' : 'Actualizar desde API'}
                        </button>
                      </div>
                    </div>

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
                        onClick={() => setClaimsFilter('FINALIZADOS')}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          claimsFilter === 'FINALIZADOS'
                            ? 'bg-emerald-950/80 border-emerald-500 shadow-sm'
                            : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-[10px] text-slate-400 block">Finalizados</span>
                        <span className="text-base font-black font-mono text-emerald-400">
                          {(claims || []).filter((c) => isClosedClaim(c?.estado)).length}
                        </span>
                      </div>

                      <div
                        onClick={() => setClaimsFilter('ABIERTOS')}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          claimsFilter === 'ABIERTOS'
                            ? 'bg-amber-950/80 border-amber-500 shadow-sm'
                            : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <span className="text-[10px] text-slate-400 block">Abiertos</span>
                        <span className="text-base font-black font-mono text-amber-400">
                          {(claims || []).filter((c) => !isClosedClaim(c?.estado)).length}
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
                        {isLoadingReclamosSla ? (
                          <div className="p-6 text-center text-slate-400">Consultando reclamos actuales…</div>
                        ) : reclamosSlaError ? (
                          <div className="p-6 text-center text-amber-300">{reclamosSlaError}</div>
                        ) : filteredClaims.length === 0 && claims.length === 0 ? (
                          <div className="p-6 text-center text-slate-400">
                            {reclamosSlaPaisTotal === 0 ? (
                              `SAC no devolvió casos para ${client.country === 'SV' ? 'El Salvador' : 'Guatemala'}.`
                            ) : reclamosSlaPaisTotal !== null ? (
                              <>
                                <p>
                                  SAC devolvió {reclamosSlaPaisTotal} casos para {client.country === 'SV' ? 'El Salvador' : 'Guatemala'}, pero ninguno coincide con el código o nombre de este cliente.
                                </p>
                                {reclamosSlaLinkDiagnostics && (
                                  <p className="mt-2 text-[11px]">
                                    Vínculo recibido: {reclamosSlaLinkDiagnostics.casosConCliente} con cliente,
                                    {' '}{reclamosSlaLinkDiagnostics.casosConCodigoCliente} con código y
                                    {' '}{reclamosSlaLinkDiagnostics.casosConNombreCliente} con nombre.
                                    Coincidencias: {reclamosSlaLinkDiagnostics.coincidenciasCodigo} por código y
                                    {' '}{reclamosSlaLinkDiagnostics.coincidenciasNombre} por nombre.
                                    {reclamosSlaLinkDiagnostics.casosConCliente === 0
                                      ? ' SAC no está vinculando estos casos con clientes.'
                                      : ''}
                                  </p>
                                )}
                              </>
                            ) : (
                              'No se encontraron reclamos para este cliente.'
                            )}
                          </div>
                        ) : filteredClaims.length === 0 ? (
                          <div className="p-6 text-center text-slate-400">
                            Ningún reclamo coincide con los filtros actuales.
                          </div>
                        ) : (
                          filteredClaims.map((clm, idx) => {
                            const isFinalizado = isClosedClaim(clm.estado);
                            const category = typeof clm.categoria === 'string'
                              ? clm.categoria
                              : clm.categoria?.nombre || clm.categoria?.categoria || clm.categoria?.name || clm.categoria?.label;
                            return (
                              <div key={clm.case_id || idx} className="p-3 hover:bg-slate-800/40 transition-colors space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-slate-200">
                                      #{clm.case_id || 'Caso'}
                                    </span>
                                    {category && (
                                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                                        {category}
                                      </span>
                                    )}
                                    {clm.tipo && clm.tipo !== category && (
                                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-950/70 text-indigo-300 font-mono">
                                        {clm.tipo}
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
                                    {clm.estado || 'Abierto'}
                                  </span>
                                </div>

                                {clm.asunto && (
                                  <div className="font-semibold text-white text-[11px]">{clm.asunto}</div>
                                )}
                                {clm.descripcion && (
                                  <p className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">
                                    <span className="font-semibold text-slate-200">Motivo / descripción: </span>
                                    {clm.descripcion}
                                  </p>
                                )}
                                {clm.resolucion && (
                                  <p className="text-[11px] text-emerald-200 whitespace-pre-wrap break-words">
                                    <span className="font-semibold">Resolución / nota final: </span>
                                    {clm.resolucion}
                                  </p>
                                )}

                                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
                                  <span>
                                    {isFinalizado ? 'Finalizado' : 'Abierto'}: {
                                      (isFinalizado ? clm.fecha_fin_resolucion || clm.fecha_actualizacion : clm.fecha_creacion)
                                        ? String(isFinalizado ? clm.fecha_fin_resolucion || clm.fecha_actualizacion : clm.fecha_creacion).split('T')[0]
                                        : '-'
                                    }
                                  </span>
                                  <span>Agente: {clm.agente?.nombre || clm.agente?.email || 'No asignado'}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
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
                                  Fecha: {p.DocDate ? String(p.DocDate).split(' ')[0] : '-'}
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-extrabold text-emerald-400 block">
                                  {p.DocTotal === undefined || p.DocTotal === null || p.DocTotal === ''
                                    ? '—'
                                    : formatSanCurrency(p.DocTotal, client.country)}
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

                {/* ========================================================================= */}
                {/* HISTORIAL RECIENTE DE GESTIONES Y VALIDACIÓN (EN EL CONTEXTO) */}
                {/* ========================================================================= */}
                <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-blue-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Historial Reciente de Gestiones
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-300 border border-blue-800/60 flex items-center gap-1">
                      <Bot className="w-3 h-3 text-cyan-400" />
                      <span>Validación de gestión</span>
                    </span>
                  </div>

                  {client.managementHistory && client.managementHistory.length > 0 ? (
                    <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                      {client.managementHistory.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/90 text-xs space-y-1.5 hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-blue-900/60 text-blue-300 border border-blue-700/50">
                                {item.callRoundLabel || `${item.callRound || 1}ª Llamada`}
                              </span>
                              <span className="text-slate-300 font-semibold">{item.channel}</span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400">
                              {item.date} {item.time ? `• ${item.time}` : ''}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-0.5">
                            <span className="text-slate-400">
                              Contacto: <strong className={item.contactSuccess === 'Sí' ? 'text-emerald-400' : 'text-amber-400'}>{item.contactSuccess}</strong>
                              {' · '}
                              Acuerdo: <strong className="text-slate-200">{item.agreement}</strong>
                            </span>
                            {item.committedAmount ? (
                              <span className="font-mono font-bold text-emerald-400">
                                ${(Number(item.committedAmount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                            ) : null}
                          </div>

                          <p className="text-[11px] text-slate-300 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                            "{item.observations}"
                          </p>

                          <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                            <span>Gestor: {item.agentName || 'Agente RED'}</span>
                            {item.aiVerdict && (
                              <span
                                className={`px-2 py-0.5 rounded-full font-bold font-mono flex items-center gap-1 ${
                                  item.aiVerdict === 'Válida'
                                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                                    : 'bg-red-950/80 text-red-300 border border-red-800/60'
                                }`}
                              >
                                {item.aiVerdict === 'Válida' ? '✓' : '✗'} Sistema: {item.aiVerdict}
                                {typeof item.aiScore === 'number' ? ` (${item.aiScore}/100)` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-1">
                      <p className="text-slate-300 font-medium">Sin llamadas previas registradas este mes</p>
                      <p className="text-[11px] text-slate-500">
                        Esta es la 1ª gestión programada (Agenda Días 1 al 22). Al guardar, el historial y el resultado de validación aparecerán aquí.
                      </p>
                    </div>
                  )}
                </div>
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
                {existingRecord ? 'Editar gestión guardada' : 'Sección B: Registro Dinámico'}
              </h3>
              <span className="text-[11px] text-slate-400">Bitácora Oficial de Cobranza</span>
            </div>

            {/* Select contact channel before entering promise contact details */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Canal de Gestión / Contacto <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1.5 rounded-xl bg-slate-900/90 border border-slate-800">
                <button
                  type="button"
                  onClick={() => selectManagementChannel('Llamada')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    managementType === 'Llamada'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <PhoneCall className="w-4 h-4 text-blue-300" />
                  <span>Llamada telefónica</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectManagementChannel('Email')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    managementType === 'Email'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Mail className="w-4 h-4 text-indigo-300" />
                  <span>Correo</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectManagementChannel('WhatsApp')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    managementType === 'WhatsApp'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <MessageSquareText className="w-4 h-4 text-emerald-300" />
                  <span>WhatsApp</span>
                </button>
              </div>
            </div>

            {/* ===================================================================== */}
            {/* PANEL INTERACTIVO DE ACCIÓN SEGÚN EL CANAL SELECCIONADO */}
            {/* ===================================================================== */}

            {/* 1. CANAL: LLAMADA TELEFÓNICA */}
            {managementType === 'Llamada' && (
              <div className="rounded-xl p-4 bg-gradient-to-br from-blue-950/40 via-slate-900/90 to-slate-950 border border-blue-500/30 space-y-3.5 shadow-lg animate-fade-in">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-300">
                    <PhoneCall className="w-4 h-4 text-blue-400" />
                     <span>
                       Llamadas PBX · {appliedPbxRangeFrom.replace('T', ' ')} — {appliedPbxRangeTo.replace('T', ' ')}
                     </span>
                  </div>
                  <button
                    type="button"
                    onClick={searchPbxCalls}
                    disabled={pbxCallsLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${pbxCallsLoading ? 'animate-spin' : ''}`} />
                    Actualizar
                  </button>
                </div>

                <p className="text-[11px] text-slate-400">
                  Se muestran llamadas al teléfono destino que coinciden con tu usuario PBX o, como respaldo, con la extensión del perfil. Confirma el nombre y la extensión antes de guardar; para el audio se usa la extensión real de la llamada.
                </p>
                <p className="rounded-lg border border-blue-900/60 bg-blue-950/30 px-3 py-2 text-[11px] text-blue-200">
                  Para guardar como llamada debes seleccionar la llamada real de la PBX. El audio y la transcripción son opcionales: si alguno no carga, la gestión no se bloquea.
                </p>

                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Teléfono destino del cliente
                  </span>
                  <input
                    type="tel"
                    list={pbxPhoneListId}
                    aria-label="Teléfono destino del cliente para buscar llamadas PBX"
                    value={pbxDestinationPhone}
                    onChange={(event) => setPbxDestinationPhone(event.target.value)}
                    placeholder="Selecciona o escribe el número del cliente"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                  />
                  <datalist id={pbxPhoneListId}>
                    {pbxClientPhones.map((phone) => <option key={phone} value={phone} />)}
                  </datalist>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Desde (fecha y hora)
                    </span>
                    <input
                      type="datetime-local"
                      aria-label="Desde fecha y hora de llamadas"
                      value={pbxRangeFrom}
                      onChange={(event) => setPbxRangeFrom(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Hasta (fecha y hora)
                    </span>
                    <input
                      type="datetime-local"
                      aria-label="Hasta fecha y hora de llamadas"
                      value={pbxRangeTo}
                      onChange={(event) => setPbxRangeTo(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={searchPbxCalls}
                    disabled={pbxCallsLoading}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Buscar llamadas
                  </button>
                </div>

                {pbxRangeValidationError && (
                  <p role="alert" className="rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
                    {pbxRangeValidationError}
                  </p>
                )}

                {pbxCallsLoading && (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
                    Consultando llamadas…
                  </div>
                )}

                {pbxCallsError && !pbxCallsLoading && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-800/70 bg-amber-950/40 p-3 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{pbxCallsError}</span>
                  </div>
                )}

                {pbxSearchIsStale && (
                  <p role="status" className="rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
                    Cambiaste el teléfono o el rango. Vuelve a buscar; no se guardará una llamada de una búsqueda anterior.
                  </p>
                )}

                {pbxCalls.length > 0 && (
                  <>
                    <select
                      aria-label="Llamada PBX para esta gestión"
                      value={selectedPbxCallId}
                      onChange={(event) => setSelectedPbxCallId(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white"
                    >
                      <option value="">Selecciona una llamada PBX…</option>
                      {pbxCalls.map((call) => {
                        const localTime = new Intl.DateTimeFormat('es-SV', {
                          timeZone: 'America/El_Salvador',
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        }).format(new Date(call.dateTime));
                        const duration = `${Math.floor(call.durationSeconds / 60)}:${String(call.durationSeconds % 60).padStart(2, '0')}`;
                        return (
                          <option key={call.callId} value={call.callId}>
                            {call.callId === recommendedPbxCallId ? '★ RECOMENDADA · ' : ''}{call.matchedBy === 'extension' ? 'COINCIDE POR EXT. · ' : ''}{localTime} · {call.username} · ext. {call.extension} · {call.destination || 'sin destino'} · {duration} · {call.state || 'sin estado'}
                          </option>
                        );
                      })}
                    </select>
                    <p className="text-[10px] text-slate-400">
                      ★ Recomendada: llamada contestada o de mayor duración. Confirma que corresponda a la conversación antes de guardar.
                    </p>

                    {selectedPbxCall && (
                      <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                        {selectedPbxCall.matchedBy === 'extension' && (
                          <p role="status" className="rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
                            Esta llamada coincide por la extensión del perfil, pero PBX la identifica como {selectedPbxCall.username}. Confirma que sea la conversación correcta antes de guardar.
                          </p>
                        )}
                        {selectedPbxCall.extensionMatchesProfile === false && (
                          <p role="status" className="rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
                            PBX reporta la extensión {selectedPbxCall.extension} y el perfil indica {selectedPbxCall.profileExtension || 'sin extensión'}. La llamada coincide con el usuario {selectedPbxCall.username}; el audio se consultará usando la extensión real de esta llamada.
                          </p>
                        )}
                        {selectedPbxCall.callId === recommendedPbxCallId && (
                          <p className="text-[10px] font-semibold text-emerald-300">
                            Esta es la llamada recomendada; la selección y confirmación final son tuyas.
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <div>
                            <span className="block text-[10px] uppercase text-slate-500">Fecha y hora</span>
                            <span className="text-slate-200">
                              {new Intl.DateTimeFormat('es-SV', {
                                timeZone: 'America/El_Salvador',
                                dateStyle: 'medium',
                                timeStyle: 'medium',
                              }).format(new Date(selectedPbxCall.dateTime))}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase text-slate-500">Duración</span>
                            <span className="font-mono font-bold text-slate-200">
                              {Math.floor(selectedPbxCall.durationSeconds / 60)}:{String(selectedPbxCall.durationSeconds % 60).padStart(2, '0')}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase text-slate-500">Origen / extensión</span>
                            <span className="text-slate-200">{selectedPbxCall.origin || selectedPbxCall.extension}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase text-slate-500">Destino</span>
                            <span className="text-slate-200">{selectedPbxCall.destination || 'No reportado por PBX'}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase text-slate-500">Estado PBX</span>
                            <span className="text-slate-200">{selectedPbxCall.state || 'No reportado'}</span>
                          </div>
                        </div>

                        <PbxCallAudioPlayer
                          key={`${selectedPbxCall.callId}-${pbxAudioRefreshKey}`}
                          src={selectedPbxCall.audioUrl}
                          filename={selectedPbxCall.recordingFile || `grabacion-${selectedPbxCall.callId}.wav`}
                          onError={() => setPbxAudioError('No se pudo cargar el audio. La llamada seleccionada sí puede guardarse; actualiza las llamadas para renovar el enlace y vuelve a intentarlo.')}
                        />
                        {pbxAudioError && (
                          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200">
                            <span>{pbxAudioError}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setPbxAudioError('');
                                setPbxRefreshKey((value) => value + 1);
                                setPbxAudioRefreshKey((value) => value + 1);
                              }}
                              className="rounded-md border border-rose-700 px-2 py-1 font-semibold hover:bg-rose-900/50"
                            >
                              Renovar y reintentar
                            </button>
                          </div>
                        )}
                        <PbxTranscriptReviewCard
                          key={selectedPbxCall.callId}
                          value={currentPbxTranscriptReview}
                          loading={pbxTranscriptLoading}
                          error={pbxTranscriptError}
                          onRetry={() => setPbxTranscriptRefreshKey((value) => value + 1)}
                        />
                      </div>
                    )}
                  </>
                )}

                {!selectedPbxCall && (
                  <p className="text-[11px] text-slate-400">
                    Selecciona una llamada PBX para registrar por teléfono. Si el contacto fue por otro medio, cambia a Correo o WhatsApp; el resto de tus notas permanece.
                  </p>
                )}
              </div>
            )}

            {/* 2. CANAL: SCRIPT MENSAJE (Biblioteca, Búsqueda, Personalización de Variables y Copia Rápida) */}
            {(managementType === 'Script Mensaje' || managementType === 'WhatsApp') && (
              <div className="rounded-xl p-4 bg-gradient-to-br from-emerald-950/40 via-slate-900/90 to-slate-950 border border-emerald-500/30 space-y-3.5 shadow-lg animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-900/40 pb-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                    <MessageSquareText className="w-4 h-4 text-emerald-400" />
                    <span>Script Mensaje · Variables en Tiempo Real</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Teléfono destino:</span>
                    <input
                      type="text"
                      value={targetWhatsAppPhone}
                      onChange={(e) => {
                        setTargetWhatsAppPhone(e.target.value);
                        if (!contactPhoneManuallyEditedRef.current) {
                          setContactPhone(e.target.value);
                        }
                      }}
                      placeholder="Número de contacto"
                      className="px-2.5 py-1 text-xs rounded-lg bg-slate-950 border border-emerald-500/40 text-emerald-300 font-mono w-32 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Selector y Búsqueda en Biblioteca de Scripts */}
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                      <span>Seleccionar Script de la Biblioteca ({scripts.length} disponibles):</span>
                    </label>
                    <div className="relative w-full sm:w-56">
                      <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Buscar script..."
                        value={scriptSearch}
                        onChange={(e) => setScriptSearch(e.target.value)}
                        className="w-full pl-7 pr-2.5 py-1 text-[11px] rounded-lg bg-slate-950/80 border border-slate-800 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <select
                    value={selectedScriptId}
                    onChange={(e) => {
                      setSelectedScriptId(e.target.value);
                      setIsCustomizingScript(false);
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-emerald-500/40 text-slate-100 font-medium focus:outline-none focus:border-emerald-400"
                  >
                    {(scripts || [])
                      .filter(
                        (s) =>
                          !scriptSearch.trim() ||
                          (s?.title || '').toLowerCase().includes((scriptSearch || '').toLowerCase()) ||
                          (s?.templateText || '').toLowerCase().includes((scriptSearch || '').toLowerCase())
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id} className="bg-slate-900 text-slate-200">
                          {s.title || 'Script'} ({s.targetAudience || 'General'})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Previsualización del Script con Variables Reemplazadas */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <span>Mensaje personalizado con datos reales de {client.code}:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomizingScript(!isCustomizingScript);
                      }}
                      className="text-[11px] text-blue-400 hover:text-blue-300 underline cursor-pointer"
                    >
                      {isCustomizingScript ? 'Restablecer automático' : 'Editar texto antes de copiar'}
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={whatsappMessage}
                    onChange={(e) => {
                      setIsCustomizingScript(true);
                      setWhatsappMessage(e.target.value);
                    }}
                    className="w-full p-3 text-xs rounded-xl bg-slate-950/90 border border-emerald-500/30 text-slate-200 font-sans leading-relaxed focus:border-emerald-400 focus:outline-none resize-y"
                  />
                </div>

                {/* Barra de Acciones del Agente: Copiar con 1 Clic y WhatsApp Web */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyWhatsApp}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
                      copiedWhatsApp
                        ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/30 scale-102'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                    }`}
                  >
                    {copiedWhatsApp ? <Check className="w-4 h-4 text-slate-950" /> : <Copy className="w-4 h-4 text-emerald-400" />}
                    <span>{copiedWhatsApp ? '¡Script Copiado al Portapapeles!' : 'Copiar Script Mensaje'}</span>
                  </button>

                  <a
                    href={`https://wa.me/${cleanWhatsAppPhone(targetWhatsAppPhone, client.country)}?text=${encodeURIComponent(whatsappMessage)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Abrir en WhatsApp</span>
                    <ExternalLink className="w-3 h-3 opacity-80" />
                  </a>
                </div>
              </div>
            )}

            <div className="space-y-4 border-t border-slate-800/80 pt-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Resultado de la gestión <span className="text-red-400">*</span>
                  </label>
                  <div className={`grid grid-cols-1 gap-2 ${canRecordPaid ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                    {([
                      { value: 'Sí' as const, label: 'Sí, hubo acuerdo' },
                      { value: 'No' as const, label: 'No, reprogramar' },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setAgreementDecision(option.value)}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                          !isPaymentOutcome && successfulContact === option.value
                            ? option.value === 'Sí'
                              ? 'border-emerald-500 bg-emerald-600/20 text-emerald-200'
                              : 'border-amber-500 bg-amber-600/20 text-amber-200'
                            : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    {canRecordPaid && (
                      <button
                        type="button"
                        onClick={setPaymentDecision}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                          isPaymentOutcome
                            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                            : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        Pago realizado
                      </button>
                    )}
                  </div>
                  {canRecordPaid && (
                    <p className="mt-1 text-[10px] text-emerald-300">
                      SAN verificado: saldo pendiente del mes actual {formatSanCurrency(0, client.country)}.
                    </p>
                  )}
                  {savedManagementChannel === 'WhatsApp' && successfulContact === 'Sí' && !isPaymentOutcome && (
                    <p className="mt-1 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-200">
                      Esta gestión se guardará como contacto exitoso por WhatsApp con el mismo formulario de promesa que una llamada.
                    </p>
                  )}
                </div>

                {isPaymentOutcome ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 space-y-3">
                      <p className="text-[11px] text-emerald-200">
                        Pago del mes actual confirmado en SAN. Para cerrar la gestión se requiere fecha, persona que pagó y comprobante.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300">Fecha en que se realizó el pago *</label>
                          <input
                            type="date"
                            value={paymentDate}
                            max={todayKey}
                            onChange={(event) => setPaymentDate(event.target.value)}
                            lang="es-SV"
                            className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300">Persona que realizó el pago *</label>
                          <input
                            value={paymentMadeBy}
                            onChange={(event) => setPaymentMadeBy(event.target.value)}
                            maxLength={120}
                            placeholder="Nombre completo"
                            autoComplete="name"
                            className="w-full px-3 py-2 text-xs rounded-xl glass-input"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[11px] font-semibold text-slate-300">Comprobante de pago *</label>
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                            onChange={(event) => setPaymentReceiptFile(event.target.files?.[0] || null)}
                            className="w-full px-3 py-2 text-xs rounded-xl glass-input file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                          />
                          <p className="text-[10px] text-slate-400">
                            PDF, JPG, PNG, WEBP o GIF · máximo 50 MB.
                          </p>
                          {paymentReceiptFile && (
                            <p className={`text-[10px] ${paymentReceiptFile.size <= MAX_PAYMENT_RECEIPT_BYTES && PAYMENT_RECEIPT_TYPES.has(paymentReceiptFile.type) ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {paymentReceiptFile.name} · {(paymentReceiptFile.size / (1024 * 1024)).toFixed(1)} MB
                              {!PAYMENT_RECEIPT_TYPES.has(paymentReceiptFile.type) ? ' · formato no permitido' : ''}
                              {paymentReceiptFile.size > MAX_PAYMENT_RECEIPT_BYTES ? ' · supera 50 MB' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-300">Observaciones extra (opcional)</label>
                      <textarea
                        rows={3}
                        value={observations}
                        onChange={(event) => setObservations(event.target.value)}
                        placeholder="Agrega contexto útil del pago, si aplica."
                        className="w-full px-3 py-2.5 text-xs rounded-xl glass-input resize-y"
                      />
                    </div>
                  </div>
                ) : successfulContact === 'Sí' ? (
                  <div className="space-y-4">
                    {isPromiseAgreement && (
                      <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 space-y-3">
                        <p className="text-[11px] text-emerald-200">
                          Para validar la promesa se necesitan persona de contacto, {usesEmailForContact ? 'correo electrónico' : 'teléfono'}, fecha y monto. La hora es opcional.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-300">Persona con quien habló *</label>
                            <input
                              value={contactName}
                              onChange={(event) => {
                                contactNameManuallyEditedRef.current = true;
                                setContactName(event.target.value);
                              }}
                              placeholder={client.contactPerson || clientSanInfo?.contactName || 'Nombre de la persona'}
                              className="w-full px-3 py-2 text-xs rounded-xl glass-input"
                              autoComplete="name"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-300">
                              {usesEmailForContact ? 'Correo electrónico de contacto *' : 'Teléfono de contacto *'}
                            </label>
                            {usesEmailForContact ? (
                              <input
                                type="email"
                                autoComplete="email"
                                value={contactEmail}
                                onChange={(event) => {
                                  contactEmailManuallyEditedRef.current = true;
                                  setContactEmail(event.target.value);
                                }}
                                placeholder="contacto@empresa.com"
                                className="w-full px-3 py-2 text-xs rounded-xl glass-input"
                              />
                            ) : (
                              <input
                                type="tel"
                                value={contactPhone || (!contactPhoneManuallyEditedRef.current && savedManagementChannel === 'WhatsApp' ? targetWhatsAppPhone : '')}
                                onChange={(event) => {
                                  contactPhoneManuallyEditedRef.current = true;
                                  setContactPhone(event.target.value);
                                }}
                                placeholder={savedManagementChannel === 'WhatsApp'
                                  ? targetWhatsAppPhone || 'Teléfono de WhatsApp'
                                  : client.phone1 || client.celular || client.telefono || 'Mínimo 8 dígitos'}
                                className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono"
                              />
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-300">Fecha de promesa *</label>
                            <input
                              type="date"
                              value={deadlineDate}
                              min={todayKey}
                              onChange={(event) => setDeadlineDate(event.target.value)}
                              lang="es-SV"
                              className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-300">Hora de promesa (opcional, AM/PM)</label>
                            <input
                              type="time"
                              value={promiseTime}
                              onChange={(event) => setPromiseTime(event.target.value)}
                              lang="en-US"
                              className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono"
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <label className="text-[11px] font-semibold text-slate-300">
                              Monto prometido ({client.country === 'GT' ? 'Q' : '$'}) *
                            </label>
                            <input
                              inputMode="decimal"
                              value={committedAmount}
                              onChange={(event) => setCommittedAmount(event.target.value)}
                              placeholder="Ej. 125.00"
                              className="w-full px-3 py-2 text-xs rounded-xl glass-input font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-300">Observaciones libres (opcional)</label>
                      <textarea
                        rows={3}
                        value={observations}
                        onChange={(event) => setObservations(event.target.value)}
                        placeholder="Agrega contexto útil de la conversación, si aplica."
                        className="w-full px-3 py-2.5 text-xs rounded-xl glass-input resize-y"
                      />
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-semibold text-slate-200">Contactos nuevos (opcional)</h4>
                          <p className="mt-1 text-[10px] text-slate-400">
                            Se guardarán en la ficha de este cliente; nombre y teléfono son obligatorios.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={contactsToAdd.length >= 10}
                          onClick={() => setContactsToAdd((current) => current.length >= 10
                            ? current
                            : [...current, { nombre: '', telefono: '', correo: '', cargo: '' }])}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Agregar
                        </button>
                      </div>

                      {contactsToAdd.map((contact, index) => (
                        <div key={index} className="rounded-lg border border-slate-700/80 bg-slate-950/40 p-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              Contacto nuevo {index + 1}
                            </span>
                            <button
                              type="button"
                              aria-label={`Quitar contacto nuevo ${index + 1}`}
                              onClick={() => setContactsToAdd((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                              className="rounded-md p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              value={contact.nombre}
                              onChange={(event) => setContactsToAdd((current) => current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, nombre: event.target.value } : row
                              ))}
                              placeholder="Nombre completo *"
                              autoComplete="name"
                              className="w-full rounded-lg glass-input px-3 py-2 text-xs"
                            />
                            <input
                              type="tel"
                              value={contact.telefono}
                              onChange={(event) => setContactsToAdd((current) => current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, telefono: event.target.value } : row
                              ))}
                              placeholder="Teléfono (8 dígitos mínimo) *"
                              autoComplete="tel"
                              className="w-full rounded-lg glass-input px-3 py-2 text-xs"
                            />
                            <input
                              type="email"
                              value={contact.correo}
                              onChange={(event) => setContactsToAdd((current) => current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, correo: event.target.value } : row
                              ))}
                              placeholder="Correo (opcional)"
                              autoComplete="email"
                              className="w-full rounded-lg glass-input px-3 py-2 text-xs"
                            />
                            <input
                              value={contact.cargo}
                              maxLength={120}
                              onChange={(event) => setContactsToAdd((current) => current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, cargo: event.target.value } : row
                              ))}
                              placeholder="Cargo (opcional)"
                              className="w-full rounded-lg glass-input px-3 py-2 text-xs"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : successfulContact ? (
                  <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-300">
                        Elige fecha para reprogramar la gestión <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="date"
                        value={rescheduleDate}
                        min={todayKey}
                        max={currentMonthEnd}
                        onChange={(event) => setRescheduleDate(event.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-xl glass-input font-mono"
                      />
                      <p className="text-[10px] text-slate-500">
                        Solo se permite una fecha futura dentro de {currentMonthLabel}.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-300">Observaciones libres (opcional)</label>
                      <textarea
                        rows={3}
                        value={observations}
                        onChange={(event) => setObservations(event.target.value)}
                        placeholder="Ej. El cliente pidió que lo llamemos después de las 3:00 p. m."
                        className="w-full px-3 py-2.5 text-xs rounded-xl glass-input resize-y"
                      />
                    </div>
                  </div>
                ) : null}
            </div>

            {/* Campos dinámicos disponibles solo en el flujo administrativo */}
            {currentUser.role === 'admin' && activeFields.length > 0 && (
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
                    {field.label || field.name || 'Campo'} {field.isRequired && <span className="text-red-400">*</span>}
                  </label>

                  {/* Dropdown */}
                  {field.type === 'dropdown' && (
                    <select
                      value={resolveFieldValue(field) || ''}
                      onChange={(e) => updateDynamicFieldValue(field.name, e.target.value, field.label)}
                      className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                    >
                      <option value="">Seleccione una opción</option>
                      {getFieldOptions(field).map((opt) => (
                        <option key={opt} value={opt} className="bg-slate-900 text-white">
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Radio */}
                  {field.type === 'radio' && (
                    <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
                      {getFieldOptions(field).map((opt) => (
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
                      {getFieldOptions(field).map((opt) => {
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
                      placeholder={`Ingrese ${(field.label || field.name || 'información').toLowerCase()}...`}
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
            )}

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
                    {validationReport.isSuccess ? 'Gestión validada' : 'Revisa la gestión'}
                  </h4>
                </div>

                <div className="text-xs text-slate-300 space-y-1 pl-7">
                  <div className="flex items-center gap-2">
                    <span className={validationReport.contactRecorded ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {validationReport.contactRecorded ? '✓' : '✗'}
                    </span>
                    <span>1. Se indicó si hubo contacto.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={validationReport.mandatoryValid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {validationReport.mandatoryValid ? '✓' : '✗'}
                    </span>
                    <span>2. Los datos obligatorios están completos.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={validationReport.agreementValid ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {validationReport.agreementValid ? '✓' : '✗'}
                    </span>
                    <span>3. Promesa válida o reprogramación en el mes seleccionado.</span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-white/10 text-xs font-semibold pl-7">
                  {validationReport.isSuccess ? (
                    <span className="text-emerald-300">
                      {successfulContact === 'Sí'
                        ? `Gestión válida. Estado: ${workflowStatus}.`
                        : `Gestión válida y reprogramada para ${rescheduleDate}.`}
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
                disabled={isSubmitting || isEvaluatingAI || pbxCallRequiredMissing}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-blue-600/30 transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSubmitting || isEvaluatingAI
                  ? existingRecord ? 'Actualizando gestión…' : 'Procesando y validando gestión…'
                  : existingRecord ? 'Guardar cambios' : 'Guardar Gestión'}
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
          country={client.country}
        />
      )}

      {/* ========================================================================= */}
      {/* DIÁLOGO DEL CALIFICADOR: GESTIÓN INVÁLIDA */}
      {/* ========================================================================= */}
      {showAIReviewDialog && aiEvaluation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-xl rounded-2xl glass-panel border border-amber-500/50 p-6 space-y-4 shadow-2xl shadow-amber-950/50 relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Revisión de gestión</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-950 text-red-300 border border-red-800 font-mono font-bold">
                      {aiEvaluation.score}/100 · Inválida
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Control de calidad y coherencia en cobros de RED INTELFON</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAIReviewDialog(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* AI Feedback Banner */}
            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs leading-relaxed">
              <p className="font-semibold text-white mb-1">{aiEvaluation.feedback}</p>
            </div>

            {/* Criteria Checklist */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
                Criterios de Evaluación Mínimos:
              </span>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">1. Coherencia Operativa (Contacto vs Acuerdo Registrado):</span>
                  <span className={`font-mono font-bold ${aiEvaluation.criteria?.coherence ? 'text-emerald-400' : 'text-red-400'}`}>
                    {aiEvaluation.criteria?.coherence ? '✓ Aprobado' : '✗ Inconsistencia'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">2. Calidad de Observación (Detalle y sentido de cobranza):</span>
                  <span className={`font-mono font-bold ${aiEvaluation.criteria?.informationQuality ? 'text-emerald-400' : 'text-red-400'}`}>
                    {aiEvaluation.criteria?.informationQuality ? '✓ Aprobado' : '✗ Vaga / Insuficiente'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">3. Enfoque en Cobranza y Factura del Mes:</span>
                  <span className={`font-mono font-bold ${aiEvaluation.criteria?.businessAlignment ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {aiEvaluation.criteria?.businessAlignment ? '✓ Aprobado' : '✗ Falta mención de pago'}
                  </span>
                </div>
              </div>
            </div>

            {/* Motivos y Recomendaciones */}
            <div className="space-y-2 max-h-36 overflow-y-auto pr-1 text-xs">
              {aiEvaluation.reasons && aiEvaluation.reasons.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Observaciones encontradas:</span>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
                    {aiEvaluation.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {aiEvaluation.recommendations && aiEvaluation.recommendations.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-slate-800">
                  <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Recomendaciones:</span>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
                    {aiEvaluation.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Reprogramming Section inside AI Dialog */}
            {showRescheduleDialog ? (
              <div className="p-3.5 rounded-xl bg-slate-900 border border-blue-500/50 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <CalendarClock className="w-4 h-4" />
                    <span>Reprogramar gestión dentro de este mes</span>
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Fecha de reprogramación *</label>
                    <input
                      type="date"
                      value={rescheduleDate}
                      min={todayKey}
                      max={currentMonthEnd}
                      onChange={(event) => setRescheduleDate(event.target.value)}
                      lang="es-SV"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-white font-mono focus:border-blue-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Motivo de Reprogramación</label>
                    <input
                      type="text"
                      value={rescheduleReason}
                      onChange={(e) => setRescheduleReason(e.target.value)}
                      placeholder="Ej: Cliente solicitó llamada otro día"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-white focus:border-blue-400"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-blue-300/80 bg-blue-950/40 p-2 rounded-lg border border-blue-800/40 leading-relaxed">
                  La gestión aparecerá en la agenda del día elegido y quedará registrada como Reprogramada.
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRescheduleDialog(false)}
                    className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700"
                  >
                    Volver atrás
                  </button>
                  <button
                    type="button"
                    disabled={!rescheduleDate || rescheduleDate < todayKey || rescheduleDate > currentMonthEnd}
                    onClick={() => {
                      if (onRescheduleClient && rescheduleDate) {
                        onRescheduleClient(client.code, rescheduleDate, rescheduleReason);
                      }
                      setShowAIReviewDialog(false);
                      onClose();
                    }}
                    className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 shadow-md shadow-blue-600/30"
                  >
                    Confirmar e Incorporar a Lista Diaria
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAIReviewDialog(false)}
                  className="w-full sm:flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-amber-400" />
                  <span>Volver a hacer / Corregir gestión ahora</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowRescheduleDialog(true)}
                  className="w-full sm:flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CalendarClock className="w-4 h-4 text-white" />
                  <span>Reprogramar en otra fecha (Días 1 al 22)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
