export interface PbxTranscriptAutoForm {
  suggestedOutcome: 'Promesa de Pago' | 'Reprogramación' | 'Revisar manualmente';
  promiseDate?: string;
  amount?: number;
  currency: 'GTQ' | 'USD';
  confidence: number;
  evidenceExcerpt: string;
  keywords: string[];
}

export function normalizePbxTranscriptReviewForStorage(
  value: unknown,
  callId: string,
  availableAfter: string,
): Record<string, unknown> {
  const review = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const autoForm = review.autoForm && typeof review.autoForm === 'object' && !Array.isArray(review.autoForm)
    ? review.autoForm as Record<string, unknown>
    : {};
  const transcriptText = typeof review.transcriptText === 'string' ? review.transcriptText : '';
  if (
    review.status !== 'ready_for_review'
    || review.sourceCallId !== callId
    || !transcriptText.trim()
  ) {
    return { status: 'pending', availableAfter };
  }

  const outcomes = new Set(['Promesa de Pago', 'Reprogramación', 'Revisar manualmente']);
  const currency = autoForm.currency === 'GTQ' ? 'GTQ' : 'USD';
  const confidence = Number(autoForm.confidence);
  const amount = Number(autoForm.amount);
  const keywords = Array.isArray(autoForm.keywords)
    ? autoForm.keywords.filter((item): item is string => typeof item === 'string').slice(0, 12)
    : [];
  return {
    status: 'ready_for_review',
    reviewRequired: true,
    availableAfter,
    generatedAt: typeof review.generatedAt === 'string' ? review.generatedAt.slice(0, 40) : new Date().toISOString(),
    sourceCallId: callId,
    transcriptText: transcriptText.slice(0, 100_000),
    transcriptTruncated: review.transcriptTruncated === true || transcriptText.length > 100_000,
    qualityRating: typeof review.qualityRating === 'string' ? review.qualityRating.slice(0, 200) : '',
    qualitySummary: typeof review.qualitySummary === 'string' ? review.qualitySummary.slice(0, 10_000) : '',
    autoForm: {
      suggestedOutcome: outcomes.has(String(autoForm.suggestedOutcome))
        ? autoForm.suggestedOutcome
        : 'Revisar manualmente',
      ...(typeof autoForm.promiseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(autoForm.promiseDate)
        ? { promiseDate: autoForm.promiseDate }
        : {}),
      ...(Number.isFinite(amount) && amount > 0 ? { amount } : {}),
      currency,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      evidenceExcerpt: typeof autoForm.evidenceExcerpt === 'string' ? autoForm.evidenceExcerpt.slice(0, 1000) : '',
      keywords,
    },
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-SV');
}

function parseNumber(value: string): number | undefined {
  let normalized = value.replace(/\s/g, '');
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
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function parseDateNearEvidence(text: string, yearHint: number): string | undefined {
  const validDate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  };
  const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (iso && validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const numeric = text.match(/\b([0-3]?\d)[/-]([01]?\d)[/-](20\d{2}|\d{2})\b/);
  if (numeric) {
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    const month = Number(numeric[2]);
    const day = Number(numeric[1]);
    if (validDate(Number(year), month, day)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const namedMonth = normalize(text).match(
    /\b([0-3]?\d)\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/,
  );
  if (!namedMonth) return undefined;
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const month = months.indexOf(namedMonth[2]) + 1;
  const day = Number(namedMonth[1]);
  const year = Number(namedMonth[3] || yearHint);
  if (!validDate(year, month, day)) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findAmount(text: string): number | undefined {
  const patterns = [
    /(?:\bQ\.?|\bGTQ|\bUSD|\$)\s*([0-9][0-9.,\s]{0,16})/gi,
    /([0-9][0-9.,\s]{0,16})\s*(?:quetzales?|d[oó]lares?|GTQ|USD)\b/gi,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const amount = parseNumber(match[1].trim());
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function yearFromDate(dateTime: string): number {
  const match = dateTime.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}

export function createPbxTranscriptAutoForm(
  transcript: string,
  country: 'SV' | 'GT',
  callDateTime = '',
): PbxTranscriptAutoForm {
  const normalized = normalize(transcript);
  const promisePatterns = [
    /\bpromesa de pago\b/,
    /\bpromet(?:o|e|io|era|ere|eran|eremos)\b/,
    /\bme comprometo\b/,
    /\bse compromete\b/,
    /\bpagare\b/,
    /\bpagara\b/,
    /\bvoy a pagar\b/,
    /\bquedo en pagar\b/,
    /\b(?:realizare|realizara|hago|hara|haran) (?:el )?pago\b/,
    /\b(?:cancelare|cancelara|cancelan|depositare|depositara|transferire|transferira)\b/,
  ];
  const reschedulePatterns = [
    /\breprogram(?:ar|amos|ado|acion)\b/,
    /\bvolver a llamar\b/,
    /\bllam(?:ar|emos) (?:de nuevo|nuevamente)\b/,
    /\bno puede pagar\b/,
    /\bno hay acuerdo\b/,
  ];
  const promiseMatch = promisePatterns.find((pattern) => pattern.test(normalized));
  const rescheduleMatch = reschedulePatterns.find((pattern) => pattern.test(normalized));
  const negatedPromise = /\b(?:no|sin|nunca|jamas)\s+(?:(?:hay\s+)?promesa(?: de pago)?|(?:me|se\s+)?compromet(?:o|e|io|ere)|promet(?:o|e|io)|voy a pagar|pagare|pagara)\b/.test(normalized);
  const isPromise = Boolean(promiseMatch && !negatedPromise);
  const suggestedOutcome = isPromise
    ? 'Promesa de Pago'
    : rescheduleMatch
      ? 'Reprogramación'
      : 'Revisar manualmente';

  const evidencePattern = isPromise ? promisePatterns.find((pattern) => pattern.test(normalized)) : reschedulePatterns.find((pattern) => pattern.test(normalized));
  const evidenceMatch = evidencePattern?.exec(normalized);
  const evidenceIndex = evidenceMatch?.index ?? 0;
  const evidenceExcerpt = transcript
    .slice(Math.max(0, evidenceIndex - 120), Math.min(transcript.length, evidenceIndex + 240))
    .trim();
  const evidenceText = evidenceExcerpt || transcript.slice(0, 360).trim();
  const yearHint = yearFromDate(callDateTime);
  const promiseDate = isPromise ? parseDateNearEvidence(evidenceText, yearHint) : undefined;
  const amount = isPromise ? findAmount(evidenceText) : undefined;
  const currency = country === 'GT' || /\b(?:quetzales?|GTQ|Q\.?)\b/i.test(evidenceText) ? 'GTQ' : 'USD';

  const keywords = [
    isPromise ? 'posible promesa de pago' : '',
    rescheduleMatch ? 'posible reprogramación' : '',
    promiseDate ? 'fecha detectada' : '',
    amount !== undefined ? 'monto detectado' : '',
  ].filter(Boolean);
  const confidence = isPromise
    ? Math.min(0.78, 0.5 + (promiseDate ? 0.12 : 0) + (amount !== undefined ? 0.08 : 0))
    : rescheduleMatch
      ? 0.45
      : 0.2;

  return {
    suggestedOutcome,
    promiseDate,
    amount,
    currency,
    confidence,
    evidenceExcerpt,
    keywords,
  };
}
