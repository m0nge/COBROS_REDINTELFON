import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSanTelemanagementPayload,
  sendSanTelemanagement,
  type SanTelemanagementInput,
} from '../server/sanTelemanagement.ts';

const promiseInput: SanTelemanagementInput = {
  clientCode: 'CL000001',
  clientName: 'Cliente de prueba',
  country: 'SV',
  agentName: 'Agente de prueba',
  timestamp: '2026-06-15T16:00:00.000Z',
  agreement: 'Promesa de Pago',
  contactSuccess: 'Sí',
  deadlineDate: '2026-06-30',
  promiseTime: '10:00',
  committedAmount: 125,
  contactPhone: '70000000',
  contactEmail: 'contacto@example.invalid',
  observations: 'Prometió pagar el 30 de junio.',
};

test('maps a valid promise to SAN fields', () => {
  assert.deepEqual(buildSanTelemanagementPayload(promiseInput), {
    Codigo_Cliente: 'CL000001',
    Nombre_Cliente: 'Cliente de prueba',
    Pais: 'SV',
    Usuario: 'Agente de prueba',
    Fecha_Inicio: '2026-06-15',
    Tipo_Gestion: 200,
    Comentario: 'Prometió pagar el 30 de junio.',
    Gestionado: 'S',
    Proxima_llamada: '6/30/2026 10:00',
    Monto_Promesa: 125,
    Fecha_Promesa: '6/30/2026 10:00',
    Monto_recuperado: 0,
    Correo1: 'contacto@example.invalid',
    Correo2: '',
    Numero_contacto: '70000000',
  });
});

test('maps a verified payment with recovered amount and no promise', () => {
  const payload = buildSanTelemanagementPayload({
    ...promiseInput,
    agreement: 'Pago realizado',
    dynamicValues: {
      paymentOutcome: 'payment_received',
      paymentDate: '2026-06-15',
      paymentEvidencePath: 'test/receipt.png',
      paymentSanMonthAmount: 200,
    },
  });
  assert.equal(payload?.Monto_Promesa, 0);
  assert.equal(payload?.Fecha_Promesa, '');
  assert.equal(payload?.Proxima_llamada, '');
  assert.equal(payload?.Monto_recuperado, 200);
});

test('does not send reprogrammed or other non-promise managements', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.SAN_TELEGESTION_API_KEY;
  let requestCount = 0;
  process.env.SAN_TELEGESTION_API_KEY = 'test-only';
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response('ok', { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendSanTelemanagement({
      ...promiseInput,
      agreement: 'Sin Acuerdo',
      contactSuccess: 'No',
      deadlineDate: undefined,
      committedAmount: undefined,
      dynamicValues: { estado: 'Reprogramado', rescheduleDate: '2026-06-30' },
    });
    assert.deepEqual(result, { status: 'skipped', reason: 'not_eligible' });
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.SAN_TELEGESTION_API_KEY;
    else process.env.SAN_TELEGESTION_API_KEY = originalApiKey;
  }
});

test('reports success only for HTTP 200', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.SAN_TELEGESTION_API_KEY;
  process.env.SAN_TELEGESTION_API_KEY = 'test-only';
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return new Response('created', { status: 201 });
  }) as typeof fetch;

  try {
    const result = await sendSanTelemanagement(promiseInput);
    assert.deepEqual(result, {
      status: 'failed',
      httpStatus: 201,
      reason: 'request_failed',
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://san.red.com.sv/API/InsertarTelegestion');
    const headers = new Headers(seen[0].init?.headers);
    assert.equal(headers.get('X-API-KEY'), 'test-only');
    assert.equal(headers.get('Content-Type'), 'application/json');
    const body = JSON.parse(String(seen[0].init?.body));
    assert.equal(body.Tipo_Gestion, 200);
    assert.equal(body.Gestionado, 'S');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.SAN_TELEGESTION_API_KEY;
    else process.env.SAN_TELEGESTION_API_KEY = originalApiKey;
  }
});
