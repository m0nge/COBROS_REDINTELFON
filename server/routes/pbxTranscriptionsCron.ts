import {
  fetchPbxTranscriptsRange,
  findMatchingPbxTranscript,
  getPbxMonthToDateTranscriptQueryRange,
  parsePbxCallDateTime,
  type PbxTranscript,
} from '../pbx.js';
import { createPbxTranscriptAutoForm } from '../pbxTranscript.js';
import { supabaseRestRequest } from '../supabaseAuth.js';

type Country = 'SV' | 'GT';
type PendingRow = {
  id: string;
  valores_dinamicos?: Record<string, unknown> | null;
  clientes?: { pais?: Country; codigo?: string } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function getPendingRows(): Promise<PendingRow[]> {
  const rows: PendingRow[] = [];
  const pageSize = 500;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      select: 'id,valores_dinamicos,clientes!inner(codigo,pais)',
      order: 'created_at.asc,id.asc',
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    params.set('valores_dinamicos->pbxTranscriptReview->>status', 'eq.pending');
    const { body } = await supabaseRestRequest(`bitacora_gestiones?${params.toString()}`);
    if (!Array.isArray(body)) throw new Error('PBX_TRANSCRIPT_QUERY_INVALID');
    rows.push(...body as PendingRow[]);
    if (body.length < pageSize) return rows;
  }
  throw new Error('PBX_TRANSCRIPT_RESULT_TOO_LARGE');
}

function getCallData(row: PendingRow): {
  values: Record<string, unknown>;
  call: Record<string, unknown>;
  review: Record<string, unknown>;
  country: Country;
} | null {
  const values = isObject(row.valores_dinamicos) ? row.valores_dinamicos : {};
  const call = isObject(values.pbxCall) ? values.pbxCall : null;
  const review = isObject(values.pbxTranscriptReview) ? values.pbxTranscriptReview : null;
  const country = row.clientes?.pais;
  if (!call || !review || (country !== 'SV' && country !== 'GT')) return null;
  const uniqueId = String(call.uniqueId || '').trim();
  const date = String(call.date || '').slice(0, 10);
  const availableAfter = Date.parse(String(review.availableAfter || ''));
  if (!uniqueId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(availableAfter)) return null;
  return { values, call, review, country };
}

export async function reconcilePbxTranscriptions() {
    const now = Date.now();
    const allEligible = (await getPendingRows())
      .map((row) => ({ row, data: getCallData(row) }))
      .filter((item): item is { row: PendingRow; data: NonNullable<ReturnType<typeof getCallData>> } =>
        Boolean(item.data && Date.parse(String(item.data.review.availableAfter)) <= now)
      );
    const selectedDates = new Set(
      [...new Set(allEligible.map((item) => String(item.data.call.date).slice(0, 10)))]
        .sort((left, right) => right.localeCompare(left))
        .slice(0, 3),
    );
    const pending = allEligible.filter((item) => selectedDates.has(String(item.data.call.date).slice(0, 10)));
    const deferred = allEligible.length - pending.length;

    if (allEligible.length === 0) {
      return {
        success: true,
        pendingEligible: 0,
        apiRangesQueried: 0,
        stored: 0,
        waiting: 0,
        deferred: 0,
        skipped: 0,
        ranAt: new Date().toISOString(),
      };
    }

    if (!process.env.PBX_API_USERNAME || !process.env.PBX_API_PASSWORD) {
      return {
        success: false,
        error: 'PBX_NOT_CONFIGURED',
        pendingEligible: allEligible.length,
        waiting: allEligible.length,
        deferred,
        ranAt: new Date().toISOString(),
      };
    }

    const rangesByMonth = new Map<string, { fromDate: string; toDate: string }>();
    for (const item of pending) {
      const date = String(item.data.call.date).slice(0, 10);
      const month = date.slice(0, 7);
      const range = getPbxMonthToDateTranscriptQueryRange(date);
      const current = rangesByMonth.get(month);
      rangesByMonth.set(month, {
        fromDate: current?.fromDate || range.fromDate,
        toDate: !current || range.toDate > current.toDate ? range.toDate : current.toDate,
      });
    }

    const callsByMonth = new Map<string, PbxTranscript[]>();
    let apiRangesQueried = 0;
    let stored = 0;
    let waiting = 0;
    let skipped = 0;

    for (const [month, range] of rangesByMonth) {
      try {
        callsByMonth.set(month, await fetchPbxTranscriptsRange(range.fromDate, range.toDate));
        apiRangesQueried += 1;
      } catch {
        // The pending calls in this month are counted as waiting below.
      }
    }

    for (const item of pending) {
      const { row, data } = item;
      const date = String(data.call.date).slice(0, 10);
      const month = date.slice(0, 7);
      const transcripts = callsByMonth.get(month);
      if (!transcripts) {
        waiting += 1;
        continue;
      }

      const callUniqueId = String(data.call.uniqueId || '');
      const callExtension = String(data.call.extension || '');
      const callUsername = String(data.call.username || '').toLocaleUpperCase('en-US');
      const transcript = findMatchingPbxTranscript(transcripts, {
        uniqueId: callUniqueId,
        country: data.country,
        extension: callExtension,
        username: callUsername,
        origin: String(data.call.origin || ''),
        destination: String(data.call.destination || ''),
        dateTime: String(data.call.dateTime || ''),
      });
      if (!transcript?.transcript.trim()) {
        waiting += 1;
        continue;
      }

      const callDateTime = String(data.call.dateTime || '');
      const autoForm = createPbxTranscriptAutoForm(transcript.transcript, data.country, callDateTime);
      const transcriptText = transcript.transcript.slice(0, 100_000);
      const review = {
        ...data.review,
        status: 'ready_for_review',
        reviewRequired: true,
        generatedAt: new Date().toISOString(),
        sourceCallId: transcript.uniqueId,
        transcriptText,
        transcriptTruncated: transcript.transcript.length > transcriptText.length,
        qualityRating: transcript.qualityRating || '',
        qualitySummary: transcript.qualitySummary || '',
        autoForm,
      };

      // Re-read immediately before patching and merge only the transcript key so the
      // agent's original form and any other dynamic values remain untouched.
      const { body: latestRows } = await supabaseRestRequest(
        `bitacora_gestiones?select=id,valores_dinamicos&id=eq.${encodeURIComponent(row.id)}&limit=1`,
      );
      if (!Array.isArray(latestRows) || !latestRows[0] || !isObject(latestRows[0].valores_dinamicos)) {
        skipped += 1;
        continue;
      }
      const latestValues = latestRows[0].valores_dinamicos as Record<string, unknown>;
      const latestReview = isObject(latestValues.pbxTranscriptReview)
        ? latestValues.pbxTranscriptReview
        : {};
      if (String(latestReview.status || '') !== 'pending') {
        skipped += 1;
        continue;
      }

      const mergedValues = {
        ...latestValues,
        pbxTranscriptReview: { ...latestReview, ...review },
      };
      await supabaseRestRequest(
        `bitacora_gestiones?id=eq.${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ valores_dinamicos: mergedValues }),
        },
      );
      stored += 1;
    }

    return {
      success: true,
      pendingEligible: pending.length,
      apiRangesQueried,
      stored,
      waiting,
      deferred,
      skipped,
      ranAt: new Date().toISOString(),
    };
}
