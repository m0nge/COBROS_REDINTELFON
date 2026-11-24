import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '../src/types.ts';
import { filterUncontactedClients } from '../src/utils/noContactados.ts';

const baseClient = (code: string, overrides: Partial<Client> = {}): Client => ({
  code,
  name: code,
  country: 'GT',
  totalDebt: 100,
  daysArrears: 20,
  moraRange: '0-30',
  state: 'Pendiente',
  priority: 'Normal',
  invoiceDate: '',
  dueDate: '',
  ...overrides,
});

test('keeps clients with no successful contact even if failed attempts were logged', () => {
  const result = filterUncontactedClients(
    [baseClient('NO-CONTACTO', { daysArrears: 40 })],
    'GT',
    new Set(),
    new Set(),
    new Set(['NO-CONTACTO']),
  );
  assert.deepEqual(result.map((client) => client.code), ['NO-CONTACTO']);
});

test('excludes contacted, paid, inactive, ineligible and zero-debt clients from the no-contact queue', () => {
  const result = filterUncontactedClients(
    [
      baseClient('CONTACTADO'),
      baseClient('PAGADO'),
      baseClient('INACTIVO', { status: 'INACTIVO' }),
      baseClient('OTRO-PAIS', { country: 'SV' }),
      baseClient('SOLO-MES-ACTUAL', { totalDebt: 0, daysArrears: 0 }),
      baseClient('SALDO-NO-VERIFICADO', { debtVerified: false }),
    ],
    'GT',
    new Set(['CONTACTADO']),
    new Set(['PAGADO']),
    new Set(['CONTACTADO', 'PAGADO', 'INACTIVO', 'OTRO-PAIS', 'SOLO-MES-ACTUAL', 'SALDO-NO-VERIFICADO']),
  );
  assert.deepEqual(result, []);
});
