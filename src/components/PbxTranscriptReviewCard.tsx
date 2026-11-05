import React, { useState } from 'react';

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
  qualityRating?: string;
  qualitySummary?: string;
  message?: string;
  autoForm?: AutoForm;
};

type PbxTranscriptReviewCardProps = {
  value: unknown;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function PbxTranscriptReviewCard({
  value,
  loading = false,
  error = '',
  onRetry,
}: PbxTranscriptReviewCardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const review = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Review
    : {};
  const autoForm = review.autoForm;
  const isReady = review.status === 'ready_for_review' && Boolean(autoForm);
  const transcriptText = review.transcriptText || '';
  const escapedSearch = searchTerm.trim() ? escapeRegExp(searchTerm.trim()) : '';
  const transcriptParts = escapedSearch
    ? transcriptText.split(new RegExp(`(${escapedSearch})`, 'ig'))
    : [transcriptText];
  const searchMatches = escapedSearch
    ? (transcriptText.match(new RegExp(escapedSearch, 'ig')) || []).length
    : 0;
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
            La transcripción y el análisis son evidencia de apoyo; no modifican ni sustituyen la gestión manual.
            {review.message ? ` ${review.message}` : !isReady && availableAfterLabel ? ` Se consultará después del ${availableAfterLabel}.` : ''}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
          isReady
            ? 'bg-amber-950 text-amber-200'
            : 'bg-slate-800 text-slate-300'
        }`}>
          {isReady
            ? 'Pendiente de revisión'
            : loading
              ? 'Consultando…'
              : error
                ? 'No disponible'
                : 'Transcripción pendiente'}
        </span>
      </div>

      {loading && (
        <p className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
          Consultando la transcripción por el ID único de la llamada. Esto no impide guardar la gestión.
        </p>
      )}
      {error && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-800/70 bg-rose-950/30 p-3">
          <p className="text-xs text-rose-200">{error} La transcripción no es necesaria para guardar.</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-rose-700 px-2.5 py-1.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-900/50"
            >
              Reintentar
            </button>
          )}
        </div>
      )}

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
          {(review.qualityRating || review.qualitySummary) && (
            <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-cyan-200">
                Análisis de calidad PBX
                {review.qualityRating ? ` · ${review.qualityRating}` : ''}
              </summary>
              {review.qualitySummary && (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                  {review.qualitySummary}
                </p>
              )}
            </details>
          )}
          {transcriptText && (
            <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-cyan-200">Ver transcripción completa</summary>
              <label className="mt-2 block text-[11px] text-slate-400">
                Buscar en la transcripción
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Palabra, fecha o monto"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500"
                />
              </label>
              {searchTerm.trim() && (
                <p className="mt-1 text-[10px] text-cyan-200">
                  {searchMatches} coincidencia{searchMatches === 1 ? '' : 's'}
                </p>
              )}
              <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                {transcriptParts.map((part, index) =>
                  escapedSearch && index % 2 === 1
                    ? <mark key={index} className="rounded bg-yellow-300/30 text-yellow-100">{part}</mark>
                    : <React.Fragment key={index}>{part}</React.Fragment>
                )}
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
