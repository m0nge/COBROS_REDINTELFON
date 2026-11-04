import React from 'react';
import { Client, DynamicField, GestionAuditRecord } from '../types';
import { ExternalLink, X } from 'lucide-react';
import { PbxTranscriptReviewCard } from './PbxTranscriptReviewCard';

interface GestionReadOnlyModalProps {
  record: GestionAuditRecord;
  client?: Client;
  dynamicFields?: DynamicField[];
  onClose: () => void;
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

const ReadOnlyField: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 break-words text-sm text-slate-100">{displayValue(value)}</div>
  </div>
);

export const GestionReadOnlyModal: React.FC<GestionReadOnlyModalProps> = ({
  record,
  client,
  dynamicFields = [],
  onClose,
  onOpenPaymentEvidence,
}) => {
  const values = record.dynamicValues || {};
  const pbxCall = values.pbxCall && typeof values.pbxCall === 'object'
    ? values.pbxCall as Record<string, unknown>
    : null;
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

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[0.9fr_1.1fr] lg:p-5">
          <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                Sección A · Contexto del cliente
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Datos consultivos; este detalle no permite editar la cartera.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ReadOnlyField label="Código de cliente" value={record.clientCode} />
              <ReadOnlyField label="País" value={record.country === 'SV' ? 'El Salvador' : 'Guatemala'} />
              <ReadOnlyField label="Cliente" value={client?.name || record.clientName} />
              <ReadOnlyField label="Clasificación" value={client?.classification} />
              <ReadOnlyField label="Contacto registrado" value={client?.contactPerson} />
              <ReadOnlyField label="Teléfono principal" value={client?.phone1 || client?.celular || client?.telefono} />
              <ReadOnlyField label="Teléfono alterno" value={client?.phone2} />
              <ReadOnlyField label="Correo" value={client?.email} />
              <ReadOnlyField label="Departamento" value={client?.department} />
              <ReadOnlyField label="Municipio" value={client?.municipality} />
              <ReadOnlyField label="Días de mora" value={client?.daysArrears} />
              <ReadOnlyField
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

          <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                Sección B · Registro de gestión
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Información guardada en la bitácora oficial. Ningún campo de este panel es editable.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ReadOnlyField label="Canal de gestión" value={record.channel} />
              <ReadOnlyField label="Ronda / seguimiento" value={record.callRoundLabel || values.callRoundLabel} />
              <ReadOnlyField label="¿Hubo contacto?" value={record.contactSuccess} />
              <ReadOnlyField label="Resultado" value={record.status || values.estado} />
              <ReadOnlyField label="Persona con quien habló" value={contactName} />
              <ReadOnlyField label="Teléfono de contacto" value={contactPhone} />
              <ReadOnlyField label="Correo de contacto" value={contactEmail} />
              <ReadOnlyField label="Acuerdo" value={record.agreement} />
              <ReadOnlyField
                label="Monto comprometido"
                value={record.committedAmount && record.committedAmount > 0
                  ? `${currency}${record.committedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : undefined}
              />
              <ReadOnlyField label="Fecha de promesa" value={record.deadlineDate} />
              <ReadOnlyField label="Hora de promesa" value={promiseTime} />
              <ReadOnlyField label="Fecha de reprogramación" value={rescheduleDate} />
              <ReadOnlyField label="Fecha de pago" value={paymentDate} />
              <ReadOnlyField label="Persona que realizó el pago" value={paymentMadeBy} />
              <ReadOnlyField
                label="Duración de llamada"
                value={record.durationSeconds && record.durationSeconds > 0 ? `${record.durationSeconds} segundos` : undefined}
              />
              <ReadOnlyField label="Evaluación registrada" value={record.aiVerdict} />
              <ReadOnlyField label="Puntaje registrado" value={record.aiScore === undefined ? undefined : `${record.aiScore}%`} />
            </div>

            {pbxCall && (
              <div className="rounded-lg border border-blue-900/60 bg-blue-950/20 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-blue-300">Datos de llamada PBX</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <ReadOnlyField label="Fecha y hora" value={pbxCall.dateTime || pbxCall.date} />
                  <ReadOnlyField label="Extensión / usuario" value={[pbxCall.extension, pbxCall.username].filter(Boolean).join(' · ')} />
                  <ReadOnlyField label="Origen" value={pbxCall.origin} />
                  <ReadOnlyField label="Destino" value={pbxCall.destination} />
                  <ReadOnlyField label="Estado de llamada" value={pbxCall.state} />
                  <ReadOnlyField label="ID PBX" value={pbxCall.uniqueId} />
                </div>
              </div>
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
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Revisión de transcripción PBX</div>
                <PbxTranscriptReviewCard value={transcriptReview} />
              </div>
            )}

            {customFields.length > 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Campos adicionales</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {customFields.map(({ label, value }) => (
                    <ReadOnlyField key={label} label={label} value={value} />
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Observaciones</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{record.observations || 'No registradas'}</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
};
