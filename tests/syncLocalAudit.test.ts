import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSupersedeExpiredPromise,
  isClientDateAlreadyManaged,
  isAlreadyStored,
  verifyInsertedRows,
  type PreparedRecord,
} from '../server/routes/syncLocalAudit.ts';

function prepared(sourceId: string, clientCode = 'CL001', clientId = 'client-1'): PreparedRecord {
  return {
    sourceId,
    clientCode,
    clientId,
    scheduledForDate: '2026-11-04',
    createdAt: '2026-11-04T15:00:00.000Z',
    channel: 'Llamada',
    agreement: 'Promesa de Pago',
    row: {
      agente_id: 'agent-1',
      cliente_id: clientId,
      valores_dinamicos: { localAuditId: sourceId },
    },
  };
}

function stored(sourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    agente_id: 'agent-1',
    cliente_id: 'client-1',
    tipo_gestion: 'Llamada',
    acuerdo: 'Promesa de Pago',
    created_at: '2026-11-04T15:03:00.000Z',
    valores_dinamicos: { localAuditId: sourceId },
    ...overrides,
  };
}

test('only treats an exact localAuditId match as an already stored management', () => {
  const record = prepared('audit-new');
  const clientCodeById = new Map([['client-1', 'CL001']]);

  assert.equal(isAlreadyStored(record, [stored('audit-new')], clientCodeById), true);
  assert.equal(isAlreadyStored(record, [stored('audit-other')], clientCodeById), false);
  assert.equal(
    isAlreadyStored(record, [stored('audit-new', { agente_id: 'other-agent' })], clientCodeById),
    false,
  );
});

test('detects an existing management only for the same client and scheduled date', () => {
  const rows = [
    {
      cliente_id: 'client-1',
      valores_dinamicos: { scheduledForDate: '2026-11-04' },
    },
  ];
  assert.equal(isClientDateAlreadyManaged('client-1', '2026-11-04', rows), true);
  assert.equal(isClientDateAlreadyManaged('client-1', '2026-11-05', rows), false);
  assert.equal(isClientDateAlreadyManaged('client-2', '2026-11-04', rows), false);
  assert.equal(isClientDateAlreadyManaged('client-1', '2026-11-04', [{
    cliente_id: 'client-1',
    valores_dinamicos: { scheduledForDate: '2026-11-04' },
  }]), true);
  assert.equal(isClientDateAlreadyManaged('client-1', '2026-11-04', [{
    cliente_id: 'client-1',
    created_at: '2026-11-04T15:00:00.000Z',
    valores_dinamicos: {},
  }]), true);
});

test('allows a fresh promise after the latest saved promise has expired', () => {
  const next = prepared('audit-new');
  next.agreement = 'Promesa de Pago';
  next.row = { acuerdo: 'Promesa de Pago', contacto_exitoso: 'Si', fecha_limite_pago: '2026-11-20' };
  const oldPromise = {
    id: 'management-old',
    acuerdo: 'Promesa de Pago',
    contacto_exitoso: 'Si',
    fecha_limite_pago: '2026-11-04',
    validacion_exitosa: true,
    created_at: '2026-11-03T15:00:00.000Z',
  };

  assert.equal(canSupersedeExpiredPromise(next, [oldPromise], '2026-11-05'), true);
});

test('does not allow repeated same-day saves or supersede a promise that is still current', () => {
  const next = prepared('audit-new');
  next.agreement = 'Promesa de Pago';
  next.row = { acuerdo: 'Promesa de Pago', contacto_exitoso: 'Si', fecha_limite_pago: '2026-11-20' };
  const currentPromise = {
    id: 'management-current',
    acuerdo: 'Promesa de Pago',
    contacto_exitoso: 'Si',
    fecha_limite_pago: '2026-11-20',
    validacion_exitosa: true,
    created_at: '2026-11-04T15:00:00.000Z',
  };

  assert.equal(canSupersedeExpiredPromise(next, [currentPromise], '2026-11-05'), false);
  assert.equal(canSupersedeExpiredPromise(next, [{
    ...currentPromise,
    fecha_limite_pago: '2026-11-05',
    created_at: '2026-11-05T15:00:00.000Z',
  }], '2026-11-05'), false);
});

test('rejects a success acknowledgement when Supabase returns no inserted rows', () => {
  assert.throws(
    () => verifyInsertedRows([prepared('audit-1')], null),
    (error: any) => error.code === 'DATABASE_WRITE_NOT_CONFIRMED' && error.status === 502,
  );
});

test('rejects a partial or mismatched database insert acknowledgement', () => {
  const first = prepared('audit-1');
  const second = prepared('audit-2', 'CL002', 'client-2');
  const validFirst = {
    ...stored('audit-1'),
    cliente_id: 'client-1',
  };

  assert.throws(
    () => verifyInsertedRows([first, second], [validFirst]),
    (error: any) => error.code === 'DATABASE_WRITE_NOT_CONFIRMED',
  );
  assert.throws(
    () => verifyInsertedRows([first], [{
      ...validFirst,
      valores_dinamicos: { localAuditId: 'wrong-id' },
    }]),
    (error: any) => error.code === 'DATABASE_WRITE_NOT_CONFIRMED',
  );
});

test('confirms success only when every returned row matches the submitted source, agent, and client', () => {
  const first = prepared('audit-1');
  const second = prepared('audit-2', 'CL002', 'client-2');
  const inserted = [
    stored('audit-1'),
    {
      ...stored('audit-2'),
      cliente_id: 'client-2',
    },
  ];

  assert.equal(verifyInsertedRows([first, second], inserted), 2);
});
