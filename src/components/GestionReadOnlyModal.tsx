import React, { useEffect, useState } from 'react';
import { Client, DynamicField, GestionAuditRecord } from '../types';
import { ExternalLink, Pencil, X } from 'lucide-react';
import { authenticatedApiFetch } from '../services/authService';
import PbxCallAudioPlayer from './PbxCallAudioPlayer';
import { PbxTranscriptReviewCard } from './PbxTranscriptReviewCard';

interface GestionReadOnlyModalProps {
  record: GestionAuditRecord;
  client?: Client;
  dynamicFields?: DynamicField[];
  onClose: () => void;
  onEdit?: () => void;
  onOpenPaymentEvidence?: (path: string) => void | Promise<void>;
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
  return value !== undefined && value !== null && value !== '';
}

function displayValue(value: unknown): string {
  if (!hasValue(value)) return 'No registrado';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value) || String(value);
  return String(value);
}

const ReadOnlyLine: React.FC<{ label: string; value: unknown }> = ({ label, value }) => {
  if (!hasValue(value)) return null;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-x-3 border-b border-slate-800/80 py-2 last:border-b-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="break-words text-sm leading-relaxed text-slate-100">{displayValue(value)}</div>
    </div>
  );
};

export const GestionReadOnlyModal: React.FC<GestionReadOnlyModalProps> = ({
  record,
  client,
  dynamicFields = [],
  onClose,
  onEdit,
  onOpenPaymentEvidence,
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

  return (
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
        className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1222] shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
              Gestión registrada · Solo lectura
            </div>
            <h2 id="gestion-readonly-title" className="mt-1 truncate text-lg font-bold text-white sm:text-xl">
              {record.clientName}
            </h2>
            <div className="mt-1 font-mono text-xs text-slate-400">
              {record.clientCode} · {record.country === 'SV' ? 'El Salvador' : 'Guatemala'} · {record.date} {record.time}
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

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-800 overflow-y-auto lg:grid-cols-[0.82fr_1.18fr] lg:divide-x lg:divide-y-0">
          <section className="min-w-0 space-y-4 p-4 sm:p-5 lg:pr-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                Sección A · Contexto del cliente
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Ficha del cliente asociada a esta gestión.</p>
            </div>
            <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <ReadOnlyLine label="Código de cliente" value={record.clientCode} />
              <ReadOnlyLine label="País" value={record.country === 'SV' ? 'El Salvador' : 'Guatemala'} />
              <ReadOnlyLine label="Cliente" value={client?.name || record.clientName} />
              <ReadOnlyLine label="Clasificación" value={client?.classification} />
              <ReadOnlyLine label="Contacto registrado" value={client?.contactPerson} />
              <ReadOnlyLine label="Teléfono principal" value={client?.phone1 || client?.celular || client?.telefono} />
              <ReadOnlyLine label="Teléfono alterno" value={client?.phone2} />
              <ReadOnlyLine label="Correo" value={client?.email} />
              <ReadOnlyLine label="Departamento" value={client?.department} />
              <ReadOnlyLine label="Municipio" value={client?.municipality} />
              <ReadOnlyLine label="Días de mora" value={client?.daysArrears} />
              <ReadOnlyLine
                label="Saldo actual"
                value={client
                  ? client.debtVerified === false
                    ? 'Pendiente de validar en SAN'
                    : `${currency}${client.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : record.totalDebt === undefined
                    ? undefined
                    : `${currency}${record.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
            </div>
          </section>

          <section className="min-w-0 space-y-4 p-4 sm:p-5 lg:pl-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                Sección B · Registro de gestión
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
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Archivo adjunto</div>
                  <div className="mt-1 truncate text-sm text-slate-100">{evidenceName || 'Comprobante de pago'}</div>
                </div>
                {onOpenPaymentEvidence && (
                  <button
                    type="button"
                    onClick={() => void onOpenPaymentEvidence(evidencePath)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-900/30 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/60"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir archivo
                  </button>
                )}
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

            <div className="border-l-2 border-emerald-500/40 pl-4 py-1">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Observaciones</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{record.observations || 'No registradas'}</p>
            </div>
          </section>
        </div>

        {onEdit && (
          <footer className="flex shrink-0 justify-end border-t border-slate-800 bg-slate-950/90 px-5 py-3">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              <Pencil className="h-4 w-4" />
              Editar gestión
            </button>
          </footer>
        )}
      </section>
    </div>
  );
};
