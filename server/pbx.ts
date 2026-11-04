import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiAuthError } from './supabaseAuth.js';

const PBX_BASE_URL = 'https://api.red.com.sv';
const PBX_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const PBX_AUDIO_TICKET_TTL_MS = 30 * 60 * 1000;

export interface PbxCall {
  uniqueId: string;
  extension: string;
  username: string;
  callDate: string;
  dateTime: string;
  origin: string;
  destination: string;
  durationSeconds: number;
  state: string;
  recordingFile: string;
}

export interface PbxTranscript {
  uniqueId: string;
  country: string;
  extension: string;
  username: string;
  dateTime: string;
  transcript: string;
}

export interface PbxAudioTicket {
  agentId: string;
  country: 'SV' | 'GT';
  date: string;
  extension: string;
  uniqueId: string;
  expiresAt: number;
}

type PbxJson = Record<string, unknown>;

let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function firstText(record: PbxJson, keys: string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return '';
}

function recordValue(value: unknown): PbxJson | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PbxJson
    : null;
}

export function getPbxUsernameFromEmail(email: string): string {
  return text(email).split('@')[0].toLocaleUpperCase('en-US');
}

export function isPbxDateKeyAllowed(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return false;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const oldest = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay - 6));
  const oldestKey = `${oldest.getUTCFullYear()}-${String(oldest.getUTCMonth() + 1).padStart(2, '0')}-${String(oldest.getUTCDate()).padStart(2, '0')}`;
  return value <= today && value >= oldestKey;
}

export function isPbxDateRangeAllowed(
  fromDate: string,
  toDate: string,
  now = new Date(),
): boolean {
  if (!isPbxDateKeyAllowed(fromDate, now) || !isPbxDateKeyAllowed(toDate, now)) return false;
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  const difference = to - from;
  return Number.isFinite(difference) && difference >= 0 && difference <= 6 * 24 * 60 * 60 * 1000;
}

export function parsePbxCallDateTime(value: string): Date | null {
  const dateTime = text(value);
  if (!dateTime) return null;
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(dateTime)
    ? dateTime
    : `${dateTime.replace(' ', 'T')}-06:00`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parsePbxDateTimeLocal(value: string): Date | null {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match[1].split('-').map(Number);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || hour > 23
    || minute > 59
  ) return null;
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:00-06:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getPbxCallDateKey(raw: PbxJson, dateTime: string): string {
  const explicitDate = firstText(raw, ['SOLO_FECHA', 'solo_fecha', 'CALL_DATE', 'callDate', 'date']);
  const explicitMatch = explicitDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (explicitMatch) {
    const [year, month, day] = explicitMatch[1].split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
    ) return explicitMatch[1];
  }

  const parsedDateTime = parsePbxCallDateTime(dateTime);
  if (!parsedDateTime) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsedDateTime);
}

export function buildPbxRecordingFileName(extension: string, uniqueId: string): string {
  const safeExtension = text(extension);
  const safeUniqueId = text(uniqueId);
  if (!/^[0-9]{1,12}$/.test(safeExtension) || !/^[A-Za-z0-9.-]{1,120}$/.test(safeUniqueId)) {
    throw new ApiAuthError('La identificación de la llamada PBX no es válida.', 400, 'PBX_CALL_ID_INVALID');
  }
  return `Grabacion_Ext_${safeExtension}_${safeUniqueId}.wav`;
}

export function normalizePbxCall(input: unknown): PbxCall | null {
  const raw = recordValue(input);
  if (!raw) return null;
  const extension = firstText(raw, ['EXTENSION', 'extension']);
  const username = firstText(raw, ['NOMBRE', 'nombre', 'USERNAME', 'username', 'user']);
  const uniqueId = firstText(raw, ['uniqueid', 'UNIQUEID', 'uniqueId', 'id']);
  const dateTime = firstText(raw, ['FECHA', 'fecha', 'datetime', 'dateTime', 'start']);
  const callDate = getPbxCallDateKey(raw, dateTime);
  const durationValue = Number(raw.DURATION_SEC ?? raw.durationSeconds ?? raw.duracion_segundos);
  const durationSeconds = Number.isFinite(durationValue) && durationValue >= 0
    ? Math.round(durationValue)
    : 0;

  if (!extension || !username || !uniqueId || !dateTime || !callDate || !parsePbxCallDateTime(dateTime)) return null;
  let recordingFile: string;
  try {
    recordingFile = buildPbxRecordingFileName(extension, uniqueId);
  } catch {
    return null;
  }

  return {
    uniqueId,
    extension,
    username: username.toLocaleUpperCase('en-US'),
    callDate,
    dateTime,
    origin: firstText(raw, ['ORIGEN', 'NUMERO_ORIGEN', 'NUMERO_ORIGEN', 'CALLERID', 'CALLER', 'FROM', 'SOURCE']) || extension,
    destination: firstText(raw, ['DESTINO', 'NUMERO_DESTINO', 'DESTINATION', 'TO']),
    durationSeconds,
    state: firstText(raw, ['ESTADO', 'estado', 'STATUS', 'status']),
    recordingFile,
  };
}

export function extractPbxCallRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const record = recordValue(payload);
  if (!record) return null;

  for (const key of ['info', 'calls', 'llamadas', 'data', 'results']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  for (const key of ['res', 'result', 'data', 'response']) {
    const nested = extractPbxCallRows(record[key]);
    if (nested) return nested;
  }
  return null;
}

async function getPbxToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - PBX_TOKEN_REFRESH_MARGIN_MS > now) {
    return cachedToken.value;
  }
  if (tokenRequest) return tokenRequest;

  const username = text(process.env.PBX_API_USERNAME);
  const password = String(process.env.PBX_API_PASSWORD || '');
  if (!username || !password) {
    throw new ApiAuthError(
      'La conexión PBX aún no está configurada en el servidor.',
      503,
      'PBX_NOT_CONFIGURED',
    );
  }

  tokenRequest = (async () => {
    let response: Response;
    try {
      response = await fetch(`${PBX_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiAuthError('No se pudo conectar con la PBX.', 502, 'PBX_UNAVAILABLE');
    }

    let payload: PbxJson | null = null;
    try {
      payload = recordValue(await response.json());
    } catch {
      // Do not include upstream response bodies in errors or logs.
    }
    const token = text(
      payload?.token
      ?? payload?.access_token
      ?? payload?.accessToken
      ?? payload?.jwt
      ?? recordValue(payload?.data)?.token
      ?? recordValue(payload?.data)?.access_token
      ?? recordValue(payload?.data)?.jwt,
    ).replace(/^Bearer\s+/i, '');
    if (!response.ok || !token) {
      cachedToken = null;
      throw new ApiAuthError('La PBX no autorizó la conexión del servidor.', 502, 'PBX_AUTH_FAILED');
    }

    let expiresAt = Date.now() + 23 * 60 * 60 * 1000;
    const tokenPayload = token.split('.')[1];
    if (tokenPayload) {
      try {
        const claims = recordValue(JSON.parse(Buffer.from(tokenPayload, 'base64url').toString('utf8')));
        const tokenExpiry = Number(claims?.exp) * 1000;
        if (Number.isFinite(tokenExpiry) && tokenExpiry > Date.now()) {
          expiresAt = Math.min(expiresAt, tokenExpiry);
        }
      } catch {
        // Retain the conservative local token lifetime when the token is opaque.
      }
    }
    cachedToken = { value: token, expiresAt };
    return token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

async function fetchWithToken(path: string, init: RequestInit, token: string): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return await fetch(`${PBX_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init.signal || AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiAuthError('No se pudo consultar el servicio PBX.', 502, 'PBX_UNAVAILABLE');
  }
}

async function fetchPbxResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getPbxToken();
  let response = await fetchWithToken(path, init, token);
  if (response.status === 401 || response.status === 403) {
    try {
      await response.body?.cancel();
    } catch {
      // The rejected response body is not needed for token refresh.
    }
    cachedToken = null;
    token = await getPbxToken();
    response = await fetchWithToken(path, init, token);
  }
  return response;
}

export async function fetchPbxCallsRange(
  fromDate: string,
  toDate: string,
  country: 'SV' | 'GT',
): Promise<PbxCall[]> {
  if (!isPbxDateRangeAllowed(fromDate, toDate)) {
    throw new ApiAuthError(
      'El rango debe estar dentro de los últimos 7 días y no puede tener más de 7 días.',
      400,
      'INVALID_CALL_DATE_RANGE',
    );
  }
  const params = new URLSearchParams({ desde: fromDate, hasta: toDate, pais: country });
  const response = await fetchPbxResponse(`/pbx/api/v1/getCalls2?${params.toString()}`);
  if (!response.ok) {
    throw new ApiAuthError('La PBX no pudo devolver las llamadas de ese rango.', 502, 'PBX_CALLS_UNAVAILABLE');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiAuthError('La PBX devolvió una respuesta de llamadas inválida.', 502, 'PBX_RESPONSE_INVALID');
  }
  const rows = extractPbxCallRows(payload);
  if (!rows) {
    throw new ApiAuthError('La PBX devolvió una estructura de llamadas no reconocida.', 502, 'PBX_RESPONSE_INVALID');
  }
  return rows.map(normalizePbxCall).filter((call): call is PbxCall => Boolean(call));
}

export async function fetchPbxCalls(date: string, country: 'SV' | 'GT'): Promise<PbxCall[]> {
  return fetchPbxCallsRange(date, date, country);
}

export async function verifyPbxCall(
  date: string,
  country: 'SV' | 'GT',
  uniqueId: string,
  extension: string,
  username: string,
): Promise<PbxCall | null> {
  const calls = await fetchPbxCalls(date, country);
  return calls.find((call) =>
    call.uniqueId === uniqueId
    && call.extension === extension
    && call.username === username.toLocaleUpperCase('en-US')
  ) || null;
}

export async function fetchPbxTranscripts(date: string): Promise<PbxTranscript[]> {
  const params = new URLSearchParams({ fechaInicial: date, fechaFinal: date });
  const response = await fetchPbxResponse(
    `/idata/api/v1/desaIssabel/getResumenLlamada?${params.toString()}`,
    { signal: AbortSignal.timeout(45_000) },
  );
  if (!response.ok) {
    throw new ApiAuthError('La PBX no pudo devolver las transcripciones de esa fecha.', 502, 'PBX_TRANSCRIPTS_UNAVAILABLE');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiAuthError('La PBX devolvió una respuesta de transcripciones inválida.', 502, 'PBX_TRANSCRIPT_RESPONSE_INVALID');
  }
  const rows = extractPbxCallRows(payload);
  if (!rows) {
    throw new ApiAuthError('La PBX devolvió una estructura de transcripciones no reconocida.', 502, 'PBX_TRANSCRIPT_RESPONSE_INVALID');
  }

  return rows.flatMap((value) => {
    const raw = recordValue(value);
    if (!raw) return [];
    const uniqueId = firstText(raw, ['uniqueid', 'UNIQUEID', 'uniqueId', 'id']);
    const transcript = firstText(raw, ['transcripcion', 'transcripción', 'TRANSCRIPCION', 'transcript']);
    if (!uniqueId || !transcript) return [];
    return [{
      uniqueId,
      country: firstText(raw, ['pais', 'PAIS', 'country']).toLocaleUpperCase('en-US'),
      extension: firstText(raw, ['extension', 'EXTENSION']),
      username: firstText(raw, ['nombre', 'NOMBRE', 'username']).toLocaleUpperCase('en-US'),
      dateTime: firstText(raw, ['fecha_hora', 'FECHA_HORA', 'FECHA', 'fecha']),
      transcript,
    }];
  });
}

export function createPbxAudioTicket(
  ticket: Omit<PbxAudioTicket, 'expiresAt'>,
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({
    ...ticket,
    expiresAt: now + PBX_AUDIO_TICKET_TTL_MS,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPbxAudioTicket(
  token: string,
  secret: string,
  now = Date.now(),
): PbxAudioTicket | null {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = createHmac('sha256', secret).update(payload).digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  try {
    const decoded = recordValue(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!decoded) return null;
    const country = text(decoded.country).toUpperCase();
    const ticket: PbxAudioTicket = {
      agentId: text(decoded.agentId),
      country: country as 'SV' | 'GT',
      date: text(decoded.date),
      extension: text(decoded.extension),
      uniqueId: text(decoded.uniqueId),
      expiresAt: Number(decoded.expiresAt),
    };
    if (
      !ticket.agentId
      || (ticket.country !== 'SV' && ticket.country !== 'GT')
      || !/^\d{4}-\d{2}-\d{2}$/.test(ticket.date)
      || !/^[0-9]{1,12}$/.test(ticket.extension)
      || !/^[A-Za-z0-9.-]{1,120}$/.test(ticket.uniqueId)
      || !Number.isFinite(ticket.expiresAt)
      || ticket.expiresAt <= now
    ) {
      return null;
    }
    return ticket;
  } catch {
    return null;
  }
}

export async function fetchPbxRecording(
  ticket: PbxAudioTicket,
  range: string,
): Promise<Response> {
  const [year, month, day] = ticket.date.split('-');
  const fileName = buildPbxRecordingFileName(ticket.extension, ticket.uniqueId);
  const path = ticket.country === 'GT'
    ? `/pbx/api/v1/rawCalls?${new URLSearchParams({
        pais: 'GT',
        anio: year,
        mes: month,
        dia: day,
        archivo: fileName,
      }).toString()}`
    : `/pbx/api/v1/getAudio/${year}/${month}/${day}/${encodeURIComponent(fileName)}`;
  const headers = new Headers();
  if (range) headers.set('Range', range);
  const response = await fetchPbxResponse(path, { headers });
  if (!response.ok) {
    throw new ApiAuthError('La grabación de esta llamada no está disponible.', response.status === 404 ? 404 : 502, 'PBX_AUDIO_UNAVAILABLE');
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/^audio\//i.test(contentType) && !/^application\/octet-stream/i.test(contentType)) {
    throw new ApiAuthError('La PBX no devolvió un archivo de audio válido.', 502, 'PBX_AUDIO_INVALID');
  }
  return response;
}
