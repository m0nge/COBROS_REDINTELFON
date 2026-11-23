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
  );
  assert.deepEqual(result.map((client) => client.code), ['NO-CONTACTO']);
});

test('excludes contacted, paid, inactive, and other-country clients from the no-contact queue', () => {
  const result = filterUncontactedClients(
    [
      baseClient('CONTACTADO'),
      baseClient('PAGADO'),
      baseClient('INACTIVO', { status: 'INACTIVO' }),
      baseClient('OTRO-PAIS', { country: 'SV' }),
    ],
    'GT',
    new Set(['CONTACTADO']),
    new Set(['PAGADO']),
  );
  assert.deepEqual(result, []);
});
