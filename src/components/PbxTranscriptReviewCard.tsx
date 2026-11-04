import React from 'react';

type AutoForm = {
  suggestedOutcome?: string;
  promiseDate?: string;
  amount?: number;
  currency?: 'GTQ' | 'USD';
  confidence?: number;
  evidenceExcerpt?: string;
  keywords?: string[];
};

type Review = {
  status?: string;
  reviewRequired?: boolean;
  availableAfter?: string;
  generatedAt?: string;
  transcriptText?: string;
  transcriptTruncated?: boolean;
  autoForm?: AutoForm;
};

export function PbxTranscriptReviewCard({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const review = value as Review;
  const autoForm = review.autoForm;
  const isReady = review.status === 'ready_for_review' && Boolean(autoForm);
  const availableAfterDate = review.availableAfter ? new Date(review.availableAfter) : null;
  const availableAfterLabel = availableAfterDate && !Number.isNaN(availableAfterDate.getTime())
    ? new Intl.DateTimeFormat('es-SV', {
        timeZone: 'America/El_Salvador',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(availableAfterDate)
    : '';

  return (
    <section className="sm:col-span-2 rounded-xl border border-cyan-800/70 bg-cyan-950/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-cyan-100">Formulario automático de transcripción</h3>
          <p className="mt-1 text-[11px] text-cyan-200/70">
            Es una sugerencia de auditoría; no modifica ni sustituye la gestión manual.
            {!isReady && availableAfterLabel ? ` Se consultará después del ${availableAfterLabel}.` : ''}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
          isReady
            ? 'bg-amber-950 text-amber-200'
            : 'bg-slate-800 text-slate-300'
        }`}>
          {isReady ? 'Pendiente de revisión' : 'Transcripción pendiente'}
        </span>
      </div>

      {isReady && autoForm && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-950/70 p-2.5">
              <div className="text-[10px] uppercase text-slate-500">Resultado sugerido</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{autoForm.suggestedOutcome || 'Revisar manualmente'}</div>
            </div>
            <div className="rounded-lg bg-slate-950/70 p-2.5">
              <div className="text-[10px] uppercase text-slate-500">Fecha detectada</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{autoForm.promiseDate || 'No detectada'}</div>
            </div>
            <div className="rounded-lg bg-slate-950/70 p-2.5">
              <div className="text-[10px] uppercase text-slate-500">Monto detectado</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">
                {typeof autoForm.amount === 'number'
                  ? `${autoForm.currency === 'GTQ' ? 'Q' : '$'}${autoForm.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : 'No detectado'}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            Confianza orientativa: {Math.round(Math.max(0, Math.min(1, Number(autoForm.confidence) || 0)) * 100)}%
            {Array.isArray(autoForm.keywords) && autoForm.keywords.length > 0
              ? ` · ${autoForm.keywords.join(' · ')}`
              : ''}
          </div>
          {autoForm.evidenceExcerpt && (
            <blockquote className="mt-3 border-l-2 border-cyan-700 pl-3 text-xs italic text-slate-200">
              {autoForm.evidenceExcerpt}
            </blockquote>
          )}
          {review.transcriptText && (
            <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-cyan-200">Ver transcripción completa</summary>
              <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                {review.transcriptText}
              </p>
              {review.transcriptTruncated && (
                <p className="mt-2 text-[10px] text-amber-300">La transcripción se recortó al límite de almacenamiento.</p>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
