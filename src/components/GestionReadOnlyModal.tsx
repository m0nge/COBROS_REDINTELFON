import React, { useEffect, useState } from 'react';
import { Client, DynamicField, GestionAuditRecord, RealClient360Data } from '../types';
import { createPortal } from 'react-dom';
import { Building2, CreditCard, Download, ExternalLink, FileText, Pencil, Plus, Radio, Smartphone, Users, X } from 'lucide-react';
import { authenticatedApiFetch } from '../services/authService';
import PbxCallAudioPlayer from './PbxCallAudioPlayer';
import { PbxTranscriptReviewCard } from './PbxTranscriptReviewCard';
import { formatDateEntry } from '../utils/dateEntry';
import { getElSalvadorDateKey } from '../utils/gestionDates';

interface GestionReadOnlyModalProps {
  record: GestionAuditRecord;
  client?: Client;
  dynamicFields?: DynamicField[];
  onClose: () => void;
  onEdit?: () => void;
  onNewManagement?: () => void;
}

const SYSTEM_VALUE_KEYS = new Set([
  'estado',
  'acuerdo',
  'contactoexitoso',
  'contactosuccess',
  'localauditid',
  'migratedfromlocalstorage',
  'scheduledfordate',
  'periodmonth',
  'summaryonly',
  'paymentoutcome',
  'paymentevidencepath',
  'paymentevidencename',
  'paymentevidencemime',
  'paymentevidencesize',
  'contactname',
  'contactphone',
  'contactemail',
  'promisetime',
  'contactchannel',
  'agreementdetails',
  'rescheduledate',
  'scheduleddate',
  'callroundlabel',
  'paymentdate',
  'paymentmadeby',
  'paymentsanverifiedat',
  'paymentsanmonthamount',
  'pbxcall',
  'pbxtranscriptreview',
  'tipo_gestion',
]);

function normalizeKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function displayValue(value: unknown): string {
  if (!hasValue(value)) return 'No registrado';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string') return formatDateEntry(value);
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value) || String(value);
  return String(value);
}

const ReadOnlyLine: React.FC<{ label: string; value: unknown }> = ({ label, value }) => {
  if (!hasValue(value)) return null;

  return (
    <div className="min-w-0 rounded-lg border border-slate-800/80 bg-slate-950/45 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm leading-relaxed text-slate-100">{displayValue(value)}</div>
    </div>
  );
};

type Client360Tab = 'facturas' | 'cliente' | 'anexos' | 'reclamos' | 'pagos' | 'equipos';

function formatCurrency(amount: unknown, country: Client['country']): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  const locale = country === 'GT' ? 'es-GT' : 'en-US';
  const symbol = country === 'GT' ? 'Q' : '$';
  return `${symbol}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getInvoiceOutstanding(invoice: RealClient360Data['invoices'][number]): number | null {
  const status = String(invoice.estado || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (['PAGADO', 'PAGADA', 'ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA'].includes(status)) return 0;
  const total = Number(String(invoice.valordoc || '').replace(/,/g, ''));
  if (!Number.isFinite(total)) return null;
  if (status.startsWith('PENDIENTE')) return Math.max(0, total);
  if (status.startsWith('PAGO PARCIAL')) {
    const paid = Number(String(invoice.pago || '').replace(/,/g, ''));
    return Number.isFinite(paid) ? Math.max(0, total - paid) : null;
  }
  return null;
}

export const GestionReadOnlyModal: React.FC<GestionReadOnlyModalProps> = ({
  record,
  client,
  dynamicFields = [],
  onClose,
  onEdit,
  onNewManagement,
}) => {
  const values = record.dynamicValues || {};
  const pbxCall = values.pbxCall && typeof values.pbxCall === 'object'
    ? values.pbxCall as Record<string, unknown>
    : null;
  const pbxCallId = String(pbxCall?.uniqueId || pbxCall?.uniqueid || '');
  const pbxCallDate = String(pbxCall?.date || pbxCall?.callDate || '');
  const pbxCallExtension = String(pbxCall?.extension || '');
  const [pbxAudioUrl, setPbxAudioUrl] = useState('');
  const [pbxAudioLoading, setPbxAudioLoading] = useState(false);
  const [pbxAudioError, setPbxAudioError] = useState('');
  const [pbxAudioRefreshKey, setPbxAudioRefreshKey] = useState(0);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [client360, setClient360] = useState<RealClient360Data | null>(null);
  const [client360Loading, setClient360Loading] = useState(true);
  const [client360Error, setClient360Error] = useState('');
  const [contextTab, setContextTab] = useState<Client360Tab>('facturas');

  useEffect(() => {
    let cancelled = false;
    setClient360(null);
    setClient360Loading(true);
    setClient360Error('');
    const query = new URLSearchParams({ cliente: record.clientCode, pais: record.country });
    void authenticatedApiFetch(`/api/cliente360?${query.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          success?: boolean;
          data?: RealClient360Data;
        } | null;
        if (!response.ok || payload?.success !== true || !payload.data) {
          throw new Error('CLIENT_360_UNAVAILABLE');
        }
        if (!cancelled) setClient360(payload.data);
      })
      .catch(() => {
        if (!cancelled) setClient360Error('El contexto SAN no está disponible en este momento.');
      })
      .finally(() => {
        if (!cancelled) setClient360Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record.clientCode, record.country]);

  useEffect(() => {
    let cancelled = false;
    setPbxAudioUrl('');
    setPbxAudioError('');
    if (!record.id || !pbxCallId) {
      setPbxAudioLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setPbxAudioLoading(true);
    const params = new URLSearchParams({
      action: 'pbx-saved-audio',
      gestion_id: record.id,
    });
    void authenticatedApiFetch(`/api/cartera?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          success?: boolean;
          audioUrl?: unknown;
        } | null;
        if (!response.ok || payload?.success !== true || typeof payload.audioUrl !== 'string') {
          throw new Error('AUDIO_TICKET_UNAVAILABLE');
        }
        if (!cancelled) setPbxAudioUrl(payload.audioUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setPbxAudioError('No se pudo preparar la grabación. Reintenta para renovar el enlace.');
        }
      })
      .finally(() => {
        if (!cancelled) setPbxAudioLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [record.id, pbxCallId, pbxCallDate, pbxCallExtension, pbxAudioRefreshKey]);

  const transcriptReview = values.pbxTranscriptReview;
  const hasTranscriptReview = transcriptReview !== undefined
    && transcriptReview !== null
    && transcriptReview !== '';
  const evidencePath = typeof values.paymentEvidencePath === 'string'
    ? values.paymentEvidencePath
    : '';
  const evidenceName = typeof values.paymentEvidenceName === 'string' && values.paymentEvidenceName
    ? values.paymentEvidenceName
    : evidencePath.split('/').pop();
  const contactName = record.contactName || values.contactName;
  const contactPhone = record.contactPhone || values.contactPhone;
  const contactEmail = record.contactEmail || values.contactEmail;
  const promiseTime = record.promiseTime || values.promiseTime;
  const rescheduleDate = values.rescheduleDate || values.scheduledDate || values.scheduledForDate;
  const paymentDate = values.paymentDate;
  const paymentMadeBy = values.paymentMadeBy;
  const customFields: Array<{ label: string; value: unknown }> = [];
  const consumedKeys = new Set<string>();

  [...dynamicFields]
    .filter((field) => field && field.isActive !== false)
    .sort((left, right) => (left.order || 0) - (right.order || 0))
    .forEach((field) => {
      const candidates = [field.name, field.id, field.label]
        .filter((candidate): candidate is string => Boolean(candidate));
      const entry = Object.entries(values).find(([key]) =>
        candidates.some((candidate) => normalizeKey(candidate) === normalizeKey(key))
      );
      if (!entry || !hasValue(entry[1]) || SYSTEM_VALUE_KEYS.has(normalizeKey(entry[0]))) return;
      consumedKeys.add(normalizeKey(entry[0]));
      customFields.push({ label: field.label || field.name, value: entry[1] });
    });

  Object.entries(values).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    if (
      !hasValue(value)
      || SYSTEM_VALUE_KEYS.has(normalized)
      || consumedKeys.has(normalized)
      || customFields.some((field) => normalizeKey(field.label) === normalized)
    ) return;
    const label = key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (character) => character.toLocaleUpperCase());
    customFields.push({ label, value });
  });

  const currency = record.country === 'GT' ? 'Q' : '$';
  const clientInfo = client360?.clientInfo;
  const invoices = client360?.invoices || [];
  const invoicesVerified = client360?.invoiceDataAvailable === true
    && client360.invoiceBalancesComplete === true;
  const contextTabs: Array<{ id: Client360Tab; label: string; count?: number; icon: React.ReactNode }> = [
    { id: 'facturas', label: 'Facturas', count: invoices.length, icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'cliente', label: 'Info & Contactos', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'anexos', label: 'Líneas & Anexos', count: client360?.anexosData?.anexos?.length, icon: <Radio className="h-3.5 w-3.5" /> },
    { id: 'reclamos', label: 'Reclamos', count: client360?.claims?.length, icon: <Building2 className="h-3.5 w-3.5" /> },
    { id: 'pagos', label: 'Pagos', count: client360?.payments?.length, icon: <CreditCard className="h-3.5 w-3.5" /> },
    { id: 'equipos', label: 'Equipos', count: client360?.equipment?.length, icon: <Smartphone className="h-3.5 w-3.5" /> },
  ];
  const openPaymentEvidence = async (download: boolean) => {
    if (!record.id || evidenceLoading) return;
    const tab = window.open('', '_blank');
    if (!tab) {
      setEvidenceError('El navegador bloqueó la apertura del comprobante. Permite ventanas emergentes e inténtalo de nuevo.');
      return;
    }
    tab.opener = null;
    setEvidenceLoading(true);
    setEvidenceError('');
    try {
      const params = new URLSearchParams({
        action: 'comprobante-gestion',
        gestion_id: record.id,
      });
      if (download) params.set('download', 'true');
      const response = await authenticatedApiFetch(`/api/cartera?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        signedUrl?: unknown;
      } | null;
      if (!response.ok || payload?.success !== true || typeof payload.signedUrl !== 'string') {
        throw new Error('PAYMENT_EVIDENCE_UNAVAILABLE');
      }
      tab.location.href = payload.signedUrl;
    } catch {
      tab.close();
      setEvidenceError('No se pudo abrir el comprobante. Inténtalo de nuevo.');
    } finally {
      setEvidenceLoading(false);
    }
  };

  return createPortal((
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="gestion-readonly-title"
        className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1222] shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 rounded-md border border-blue-700/50 bg-blue-900/50 px-2.5 py-1 font-mono text-xs font-bold text-blue-300">
              {record.clientCode}
            </span>
            <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
              Gestión registrada · Solo lectura
            </div>
            <h2 id="gestion-readonly-title" className="mt-1 truncate text-lg font-bold text-white sm:text-xl">
              {client360?.clientInfo?.CardName || client?.name || record.clientName}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{record.country === 'SV' ? 'El Salvador' : 'Guatemala'}</span>
              <span>•</span>
              <span className="text-blue-300">{client360?.clientInfo?.CATEGORIA || client?.classification || 'Cliente corporativo'}</span>
              <span>•</span>
              <span>{record.date} {record.time}</span>
            </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle de gestión"
            className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-800 overflow-y-auto lg:grid-cols-12 lg:divide-x lg:divide-y-0">
          <section className="min-w-0 space-y-4 bg-slate-950/50 p-4 sm:p-5 lg:col-span-6 lg:overflow-y-auto lg:pr-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                  Sección A · Contexto 360 integral (solo lectura)
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Facturación y pagos desde SAN; cartera asignada desde SAP.</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                invoicesVerified
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              }`}>
                {client360Loading ? 'Consultando SAN…' : invoicesVerified ? 'SAN verificado' : 'SAN por validar'}
              </span>
            </div>

            {client360Loading ? (
              <div role="status" className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-xs text-slate-300">
                Consultando el contexto del cliente en SAN…
              </div>
            ) : client360Error ? (
              <div role="alert" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-xs text-amber-200">
                {client360Error} Se muestran los datos de cartera que ya estaban disponibles.
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Pendientes', amount: client360?.summary.pendientesMonto, detail: invoicesVerified ? `${client360?.summary.pendientesCount || 0} pendientes` : 'Saldo por validar', color: 'border-red-800/60 bg-red-950/35 text-red-300' },
                { label: 'Pagadas', amount: client360?.summary.pagadasMonto, detail: invoicesVerified ? `${client360?.summary.pagadasCount || 0} canceladas` : 'No verificado', color: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300' },
                { label: 'Emitidas', amount: client360?.summary.totalEmitidasMonto, detail: invoicesVerified ? `${client360?.summary.totalEmitidasCount || 0} facturas` : 'No verificado', color: 'border-blue-800/60 bg-blue-950/30 text-blue-300' },
                { label: 'Saldo mes actual', amount: client360?.summary.mesPendientesMonto, detail: invoicesVerified ? `${client360?.summary.mesPendientesCount || 0} pendientes` : 'No verificado', color: 'border-purple-800/60 bg-purple-950/30 text-purple-300' },
              ].map((tile) => (
                <div key={tile.label} className={`min-w-0 rounded-xl border p-2.5 ${tile.color}`}>
                  <div className="truncate text-[9px] font-bold uppercase tracking-wide">{tile.label}</div>
                  <div className="mt-1 truncate font-mono text-sm font-black text-white">
                    {invoicesVerified ? formatCurrency(tile.amount, record.country) : '—'}
                  </div>
                  <div className="mt-1 truncate text-[9px] opacity-80">{tile.detail}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-slate-800 pb-1">
              {contextTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setContextTab(tab.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${
                    contextTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  {tab.icon}
                  {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
                </button>
              ))}
            </div>

            <div className="min-h-[210px] space-y-2">
              {contextTab === 'facturas' && (
                invoices.length > 0 ? invoices.slice(0, 15).map((invoice, index) => {
                  const outstanding = getInvoiceOutstanding(invoice);
                  const isPaid = outstanding === 0;
                  const currentMonthKey = getElSalvadorDateKey().slice(0, 7);
                  const isCurrentMonth = String(invoice.fechaEmision || '').slice(0, 7) === currentMonthKey
                    || String(invoice.fechavence || '').slice(0, 7) === currentMonthKey;
                  const invoiceUrl = invoice.url ? `https://san.red.com.sv/${invoice.url}` : '';
                  return (
                    <div key={invoice.DocEntry || invoice.DOCENTRY || index} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span className="font-mono font-bold text-slate-100">Doc: {invoice.numdoc || invoice.DocEntry}</span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{invoice.tipodoc || 'Factura'}</span>
                          <span className={`rounded px-1.5 py-0.5 font-bold ${
                            isPaid ? 'bg-emerald-500/15 text-emerald-300'
                              : isCurrentMonth ? 'bg-purple-500/15 text-purple-300'
                                : 'bg-red-500/15 text-red-300'
                          }`}>
                            {isPaid ? 'PAGADO' : isCurrentMonth ? 'FACTURA DEL MES' : 'PENDIENTE (MORA)'}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-400">
                          Emisión: {invoice.fechaEmision || '—'} · Vence: {invoice.fechavence || '—'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right font-mono text-xs font-bold text-white">
                          {formatCurrency(invoice.valordoc, record.country)}
                          {outstanding !== null && outstanding > 0.01 && (
                            <div className="text-[9px] font-normal text-red-300">Pendiente {formatCurrency(outstanding, record.country)}</div>
                          )}
                        </div>
                        {invoiceUrl && (
                          <a href={invoiceUrl} target="_blank" rel="noreferrer" className="rounded bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700" aria-label="Abrir factura">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                }) : <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-6 text-center text-xs text-slate-400">No hay facturas disponibles.</p>
              )}

              {contextTab === 'cliente' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <ReadOnlyLine label="Código de cliente" value={record.clientCode} />
                  <ReadOnlyLine label="País" value={record.country === 'SV' ? 'El Salvador' : 'Guatemala'} />
                  <ReadOnlyLine label="Cliente" value={clientInfo?.CardName || client?.name || record.clientName} />
                  <ReadOnlyLine label="Clasificación" value={clientInfo?.CATEGORIA || client?.classification} />
                  <ReadOnlyLine label="Contacto registrado" value={clientInfo?.['CONTACTO COBROS'] || client?.contactPerson} />
                  <ReadOnlyLine label="Teléfono principal" value={clientInfo?.['TELEFONO 1'] || client?.phone1 || client?.celular || client?.telefono} />
                  <ReadOnlyLine label="Teléfono alterno" value={clientInfo?.['TELEFONO 2'] || client?.phone2} />
                  <ReadOnlyLine label="Correo" value={clientInfo?.EMAIL || client?.email} />
                  <ReadOnlyLine label="Departamento" value={clientInfo?.DEPARTAMENTO || client?.department} />
                  <ReadOnlyLine label="Municipio" value={clientInfo?.MUNICIPIO || client?.municipality} />
                  <ReadOnlyLine label="Días de mora" value={client?.daysArrears} />
                  <ReadOnlyLine label="Saldo actual" value={invoicesVerified ? formatCurrency(client360?.summary.pendientesMonto, record.country) : client?.debtVerified === false ? 'Pendiente de validar en SAN' : client?.totalDebt} />
                </div>
              )}

              {contextTab === 'anexos' && (
                <div className="space-y-2">
                  {(client360?.anexosData?.anexos || []).map((item, index) => (
                    <div key={`${item.id || item.anexo}-${index}`} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs sm:grid-cols-4">
                      <ReadOnlyLine label="Anexo" value={item.anexo} />
                      <ReadOnlyLine label="Teléfono" value={item.telefono} />
                      <ReadOnlyLine label="Flota" value={item.flota} />
                      <ReadOnlyLine label="Estado" value={item.estado} />
                    </div>
                  ))}
                  {!client360?.anexosData?.anexos?.length && <p className="text-center text-xs text-slate-400">No hay líneas o anexos disponibles.</p>}
                </div>
              )}

              {contextTab === 'reclamos' && (
                <div className="space-y-2">
                  {(client360?.claims || []).map((claim, index) => (
                    <div key={`${claim.correl}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs">
                      <div className="flex justify-between gap-2 font-semibold text-slate-100"><span>{claim.asunto || claim.reclamo || `Reclamo ${claim.correl}`}</span><span className="text-blue-300">{claim.estado}</span></div>
                      <div className="mt-1 text-slate-400">{claim.fechatrx || 'Fecha no disponible'} · {claim.tipo || claim.tecnologia || 'Sin categoría'}</div>
                      {claim.descripcion && <p className="mt-2 whitespace-pre-wrap text-slate-300">{claim.descripcion}</p>}
                    </div>
                  ))}
                  {!client360?.claims?.length && <p className="text-center text-xs text-slate-400">No hay reclamos disponibles.</p>}
                </div>
              )}

              {contextTab === 'pagos' && (
                <div className="space-y-2">
                  {(client360?.payments || []).map((payment, index) => (
                    <div key={`${payment.DocEntry}-${index}`} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs sm:grid-cols-4">
                      <ReadOnlyLine label="Documento" value={payment.DocNum || payment.DocEntry} />
                      <ReadOnlyLine label="Fecha" value={payment.DocDate} />
                      <ReadOnlyLine label="Monto" value={formatCurrency(payment.DocTotal, record.country)} />
                      <ReadOnlyLine label="Detalle" value={payment.Comments || payment.JrnlMemo} />
                    </div>
                  ))}
                  {!client360?.payments?.length && <p className="text-center text-xs text-slate-400">No hay pagos disponibles.</p>}
                </div>
              )}

              {contextTab === 'equipos' && (
                <div className="space-y-2">
                  {(client360?.equipment || []).map((equipment, index) => (
                    <div key={`${equipment.eqpcod || equipment.eqpser}-${index}`} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs sm:grid-cols-4">
                      <ReadOnlyLine label="Código" value={equipment.eqpcod} />
                      <ReadOnlyLine label="Serie" value={equipment.eqpser} />
                      <ReadOnlyLine label="Equipo" value={equipment.eqpnam} />
                      <ReadOnlyLine label="Tipo" value={equipment.eqptip} />
                    </div>
                  ))}
                  {!client360?.equipment?.length && <p className="text-center text-xs text-slate-400">No hay equipos disponibles.</p>}
                </div>
              )}
            </div>
          </section>

          <section className="min-w-0 space-y-4 p-4 sm:p-5 lg:col-span-6 lg:overflow-y-auto lg:pl-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                Sección B · Registro dinámico (solo lectura)
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Datos confirmados en la bitácora · Solo lectura
              </p>
            </div>
            <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <ReadOnlyLine label="Canal de gestión" value={record.channel} />
              <ReadOnlyLine label="Fecha y hora de registro" value={[record.date, record.time].filter(Boolean).join(' · ')} />
              <ReadOnlyLine label="Día de agenda" value={record.scheduledForDate || values.scheduledForDate} />
              <ReadOnlyLine label="Ronda / seguimiento" value={record.callRoundLabel || values.callRoundLabel} />
              <ReadOnlyLine label="¿Hubo contacto?" value={record.contactSuccess} />
              <ReadOnlyLine label="Resultado" value={record.status || values.estado} />
              <ReadOnlyLine label="Persona con quien habló" value={contactName} />
              <ReadOnlyLine label="Teléfono de contacto" value={contactPhone} />
              <ReadOnlyLine label="Correo de contacto" value={contactEmail} />
              <ReadOnlyLine label="Acuerdo" value={record.agreement} />
              <ReadOnlyLine label="Detalle del acuerdo" value={values.agreementDetails} />
              <ReadOnlyLine
                label="Monto comprometido"
                value={record.committedAmount && record.committedAmount > 0
                  ? `${currency}${record.committedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : undefined}
              />
              <ReadOnlyLine label="Fecha de promesa" value={record.deadlineDate || values.deadlineDate} />
              <ReadOnlyLine label="Hora de promesa" value={promiseTime} />
              <ReadOnlyLine label="Fecha de reprogramación" value={rescheduleDate} />
              <ReadOnlyLine label="Fecha de pago" value={paymentDate} />
              <ReadOnlyLine label="Persona que realizó el pago" value={paymentMadeBy} />
              <ReadOnlyLine
                label="Duración de llamada"
                value={record.durationSeconds && record.durationSeconds > 0 ? `${record.durationSeconds} segundos` : undefined}
              />
              <ReadOnlyLine label="Evaluación registrada" value={record.aiVerdict} />
              <ReadOnlyLine label="Puntaje registrado" value={record.aiScore === undefined ? undefined : `${record.aiScore}%`} />
            </div>

            {pbxCall && (
              <section className="space-y-3 rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-950/25 via-slate-950/70 to-slate-900/70 p-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-blue-300">Llamada PBX</div>
                  <p className="mt-1 text-[11px] text-slate-400">Datos de la llamada vinculada a esta gestión.</p>
                </div>
                <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
                  <ReadOnlyLine label="Fecha y hora" value={pbxCall.dateTime || pbxCall.date} />
                  <ReadOnlyLine label="Extensión / usuario" value={[pbxCall.extension, pbxCall.username].filter(Boolean).join(' · ')} />
                  <ReadOnlyLine label="Origen" value={pbxCall.origin} />
                  <ReadOnlyLine label="Destino" value={pbxCall.destination} />
                  <ReadOnlyLine label="Estado de llamada" value={pbxCall.state} />
                  <ReadOnlyLine label="ID PBX" value={pbxCall.uniqueId} />
                </div>
                <div className="space-y-2">
                  {pbxAudioLoading && (
                    <p className="text-xs text-slate-400" role="status">Preparando el audio…</p>
                  )}
                  {pbxAudioUrl && (
                    <PbxCallAudioPlayer
                      key={`${record.id}-${pbxCallId}-${pbxAudioRefreshKey}`}
                      src={pbxAudioUrl}
                      filename={String(pbxCall.recordingFile || `grabacion-${pbxCallId}.wav`)}
                      onError={() => setPbxAudioError('No se pudo reproducir el audio. Renueva el enlace e inténtalo de nuevo.')}
                    />
                  )}
                  {!pbxCallId && (
                    <p className="text-xs text-amber-200">
                      Esta gestión no tiene un identificador de llamada PBX para recuperar la grabación.
                    </p>
                  )}
                  {pbxAudioError && (
                    <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                      <span>{pbxAudioError}</span>
                      <button
                        type="button"
                        onClick={() => setPbxAudioRefreshKey((value) => value + 1)}
                        className="rounded-md border border-rose-700 px-2 py-1 font-semibold hover:bg-rose-900/50"
                      >
                        Renovar y reintentar
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {evidencePath && (
              <div className="space-y-2 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Archivo adjunto</div>
                    <div className="mt-1 truncate text-sm text-slate-100">{evidenceName || 'Comprobante de pago'}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openPaymentEvidence(false)}
                      disabled={evidenceLoading || !record.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-900/30 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir comprobante
                    </button>
                    <button
                      type="button"
                      onClick={() => void openPaymentEvidence(true)}
                      disabled={evidenceLoading || !record.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Descargar
                    </button>
                  </div>
                </div>
                {evidenceLoading && <p role="status" className="text-[11px] text-emerald-200">Preparando el comprobante…</p>}
                {evidenceError && <p role="alert" className="text-[11px] text-rose-300">{evidenceError}</p>}
              </div>
            )}

            {hasTranscriptReview && (
              <div className="border-l-2 border-blue-500/50 pl-4 py-1">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Revisión de transcripción PBX</div>
                <PbxTranscriptReviewCard value={transcriptReview} />
              </div>
            )}

            {customFields.length > 0 && (
              <div className="pt-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Campos adicionales</div>
                <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
                  {customFields.map(({ label, value }) => (
                    <ReadOnlyLine key={label} label={label} value={value} />
                  ))}
                </div>
              </div>
            )}

            {record.observations?.trim() && (
              <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Observaciones guardadas</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{record.observations}</p>
              </div>
            )}
          </section>
        </div>

        {(onEdit || onNewManagement) && (
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-800 bg-slate-950/90 px-5 py-3">
            {onNewManagement && (
              <button
                type="button"
                onClick={onNewManagement}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Nueva gestión
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                <Pencil className="h-4 w-4" />
                Editar gestión
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  ), document.body);
};
