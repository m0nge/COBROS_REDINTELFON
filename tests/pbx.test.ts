import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPbxRecordingFileName,
  createPbxAudioTicket,
  extractPbxCallRows,
  fetchPbxCalls,
  fetchPbxCallsRange,
  fetchPbxTranscripts,
  getPbxUsernameFromEmail,
  isPbxDateKeyAllowed,
  isPbxDateRangeAllowed,
  normalizePbxCall,
  parsePbxCallDateTime,
  parsePbxDateTimeLocal,
  verifyPbxAudioTicket,
} from '../server/pbx.ts';
import { createPbxTranscriptAutoForm } from '../server/pbxTranscript.ts';

test('PBX username is derived from the email local part', () => {
  assert.equal(getPbxUsernameFromEmail('mdcastillo@red.com.sv'), 'MDCASTILLO');
});
test('normalizes the documented PBX call fields and recording name', () => {
  const call = normalizePbxCall({
    EXTENSION: '6056',
    DESTINO: '23837777',
    DURATION_SEC: '187',
    ESTADO: 'CONTESTADA',
    NOMBRE: 'GHERRERA',
    FECHA: '2026-11-03T09:18:16.000Z',
    uniqueid: '1793719096.5903',
  });
  assert.deepEqual(call, {
    uniqueId: '1793719096.5903',
    extension: '6056',
    username: 'GHERRERA',
    callDate: '2026-11-03',
    dateTime: '2026-11-03T09:18:16.000Z',
    origin: '6056',
    destination: '23837777',
    durationSeconds: 187,
    state: 'CONTESTADA',
    recordingFile: 'Grabacion_Ext_6056_1793719096.5903.wav',
  });
});

test('derives the call date in the local UTC-6 timezone for recording lookup', () => {
  const call = normalizePbxCall({
    EXTENSION: '6056',
    DESTINO: '23837777',
    DURATION_SEC: '187',
    NOMBRE: 'GHERRERA',
    FECHA: '2026-11-04T02:18:16.000Z',
    uniqueid: '1793719096.5903',
  });
  assert.equal(call?.callDate, '2026-11-03');
});

test('extracts call arrays from the PBX response envelope', () => {
  const rows = [{ uniqueid: 'abc' }];
  assert.deepEqual(extractPbxCallRows({ res: { info: rows } }), rows);
  assert.deepEqual(extractPbxCallRows([]), []);
});

test('rejects unsafe recording path components', () => {
  assert.throws(() => buildPbxRecordingFileName('../6056', '1793719096.5903'));
  assert.throws(() => buildPbxRecordingFileName('6056', '../../audio'));
});

test('audio ticket is scoped, signed, and expires', () => {
  const ticket = createPbxAudioTicket({
    agentId: 'agent-1',
    country: 'GT',
    date: '2026-11-03',
    extension: '6056',
    uniqueId: '1793719096.5903',
  }, 'test-secret', 1_000);
  assert.equal(
    verifyPbxAudioTicket(ticket, 'test-secret', 2_000)?.uniqueId,
    '1793719096.5903',
  );
  assert.equal(verifyPbxAudioTicket(ticket, 'wrong-secret', 2_000), null);
  assert.equal(verifyPbxAudioTicket(ticket, 'test-secret', 31 * 60 * 1000), null);
});

test('interprets PBX local timestamps without an explicit timezone', () => {
  assert.equal(
    parsePbxCallDateTime('2026-11-03 09:18:16')?.toISOString(),
    '2026-11-03T15:18:16.000Z',
  );
});

test('parses browser local date-time inputs as El Salvador time', () => {
  assert.equal(
    parsePbxDateTimeLocal('2026-11-03T09:18')?.toISOString(),
    '2026-11-03T15:18:00.000Z',
  );
  assert.equal(parsePbxDateTimeLocal('2026-02-30T09:18'), null);
  assert.equal(parsePbxDateTimeLocal('2026-11-03T24:00'), null);
});

test('accepts only valid PBX dates from today through the prior six days', () => {
  const reference = new Date('2026-11-04T12:00:00.000Z');
  assert.equal(isPbxDateKeyAllowed('2026-11-04', reference), true);
  assert.equal(isPbxDateKeyAllowed('2026-10-29', reference), true);
  assert.equal(isPbxDateKeyAllowed('2026-10-28', reference), false);
  assert.equal(isPbxDateKeyAllowed('2026-11-05', reference), false);
  assert.equal(isPbxDateKeyAllowed('2026-02-31', reference), false);
});

test('accepts only ordered PBX ranges of up to seven allowed calendar days', () => {
  const reference = new Date('2026-11-04T12:00:00.000Z');
  assert.equal(isPbxDateRangeAllowed('2026-10-29', '2026-11-04', reference), true);
  assert.equal(isPbxDateRangeAllowed('2026-10-28', '2026-11-04', reference), false);
  assert.equal(isPbxDateRangeAllowed('2026-11-04', '2026-11-04', reference), true);
  assert.equal(isPbxDateRangeAllowed('2026-11-03', '2026-11-02', reference), false);
});

test('transcript parser does not invent a payment promise from unrelated conversation', () => {
  const form = createPbxTranscriptAutoForm(
    'La persona no estaba disponible. Enviaré la información del evento por correo electrónico.',
    'GT',
    '2026-11-03T09:18:16.000Z',
  );
  assert.equal(form.suggestedOutcome, 'Revisar manualmente');
  assert.equal(form.promiseDate, undefined);
  assert.equal(form.amount, undefined);
});

test('transcript parser does not treat a negated promise as an agreement', () => {
  const form = createPbxTranscriptAutoForm(
    'El cliente indicó que no se compromete a pagar este mes y pidió que llamemos nuevamente.',
    'SV',
    '2026-11-03T09:18:16.000Z',
  );
  assert.equal(form.suggestedOutcome, 'Reprogramación');
});

test('transcript parser does not promote a denied promise phrase', () => {
  const form = createPbxTranscriptAutoForm(
    'No hay promesa de pago; el cliente indicó que primero revisará sus facturas.',
    'SV',
    '2026-11-03T09:18:16.000Z',
  );
  assert.equal(form.suggestedOutcome, 'Revisar manualmente');
});

test('transcript parser suggests a promise only when payment language is present', () => {
  const form = createPbxTranscriptAutoForm(
    'Me comprometo a pagar Q 1,500.00 el 15 de noviembre de 2026.',
    'GT',
    '2026-11-03T09:18:16.000Z',
  );
  assert.equal(form.suggestedOutcome, 'Promesa de Pago');
  assert.equal(form.promiseDate, '2026-11-15');
  assert.equal(form.amount, 1500);
  assert.equal(form.currency, 'GTQ');
  assert.equal(form.confidence, 0.7);
});

test('uses the documented authenticated PBX call and transcript endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const originalUsername = process.env.PBX_API_USERNAME;
  const originalPassword = process.env.PBX_API_PASSWORD;
  const pbxDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  process.env.PBX_API_USERNAME = 'test-user';
  process.env.PBX_API_PASSWORD = 'test-password';
  const requests: Array<{ url: string; authorization?: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization') || undefined,
    });
    if (url.endsWith('/login')) {
      return Response.json({ token: 'test-jwt' });
    }
    if (url.includes('/pbx/api/v1/getCalls2?')) {
      return Response.json({
        res: {
          info: [{
            EXTENSION: '6056',
            DESTINO: '23837777',
            DURATION_SEC: '187',
            ESTADO: 'CONTESTADA',
            NOMBRE: 'GHERRERA',
            FECHA: '2026-11-03T09:18:16.000Z',
            uniqueid: '1793719096.5903',
          }],
        },
      });
    }
    if (url.includes('/idata/api/v1/desaIssabel/getResumenLlamada?')) {
      return Response.json([{
        pais: 'GT',
        extension: '6056',
        nombre: 'GHERRERA',
        uniqueid: '1793719096.5903',
        transcripcion: 'Me comprometo a pagar Q 1,500.00 el 15 de noviembre.',
      }]);
    }
    throw new Error('Unexpected PBX request path');
  }) as typeof fetch;

  try {
    const calls = await fetchPbxCalls(pbxDate, 'GT');
    const rangeCalls = await fetchPbxCallsRange(pbxDate, pbxDate, 'GT');
    const transcripts = await fetchPbxTranscripts(pbxDate);
    assert.equal(calls[0]?.uniqueId, '1793719096.5903');
    assert.equal(rangeCalls[0]?.callDate, '2026-11-03');
    assert.equal(transcripts[0]?.transcript.includes('Me comprometo'), true);
    assert.equal(requests.filter((request) => request.url.endsWith('/login')).length, 1);
    assert.equal(requests.every((request) => request.authorization === 'Bearer test-jwt'), false);
    assert.equal(requests.slice(1).every((request) => request.authorization === 'Bearer test-jwt'), true);
    assert.match(requests[1].url, new RegExp(`desde=${pbxDate}`));
    assert.match(requests[1].url, /pais=GT/);
    assert.match(requests[2].url, new RegExp(`hasta=${pbxDate}`));
    assert.match(requests[3].url, new RegExp(`fechaInicial=${pbxDate}`));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUsername === undefined) delete process.env.PBX_API_USERNAME;
    else process.env.PBX_API_USERNAME = originalUsername;
    if (originalPassword === undefined) delete process.env.PBX_API_PASSWORD;
    else process.env.PBX_API_PASSWORD = originalPassword;
  }
});
