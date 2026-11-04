import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, SanClientInfo } from '../src/types.ts';
import type { ContactoCobros } from '../src/services/contactosCobrosService.ts';
import { resolveContactAutofill } from '../src/utils/contactAutofill.ts';

const client = {
  code: 'CL001234',
  country: 'SV',
  name: 'Empresa de ejemplo, S.A.',
  phone1: '22001122',
  email: 'contacto@empresa.test',
} as Client;

const contacts: ContactoCobros[] = [{
  id: 'contact-1',
  pais: 'SV',
  codigo_cliente: 'CL001234',
  numero_contacto: 1,
  nombre: 'María López',
  cargo: 'Cuentas por pagar',
  telefono_fijo: '22223333',
  correo: 'maria@empresa.test',
  whatsapp: '77778888',
}];

test('uses the registered contact and the phone for the selected channel', () => {
  const result = resolveContactAutofill(client, contacts, null, 'WhatsApp');

  assert.deepEqual(result, {
    name: 'María López',
    phone: '77778888',
    email: 'maria@empresa.test',
  });
});

test('falls back to SAN and client details when no saved contact exists', () => {
  const sanInfo = {
    CardCode: 'CL001234',
    CardName: 'Empresa de ejemplo, S.A.',
    'CONTACTO COBROS': 'José Pérez',
    'TELEFONO COBROS': '22334455',
    'CORREO COBROS': 'cobros@empresa.test',
  } satisfies SanClientInfo;

  assert.deepEqual(resolveContactAutofill(client, [], sanInfo, 'Llamada'), {
    name: 'José Pérez',
    phone: '22334455',
    email: 'cobros@empresa.test',
  });
});

test('does not guess a person from the company name', () => {
  const result = resolveContactAutofill(
    { ...client, contactPerson: undefined, email: undefined },
    [],
    null,
    'Llamada',
  );

  assert.equal(result.name, '');
  assert.equal(result.phone, '22001122');
  assert.equal(result.email, '');
});
