import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresPbxCallSelection } from '../src/utils/pbxManagement.ts';

test('a phone reprogramming after no contact does not require a PBX call selection', () => {
  assert.equal(requiresPbxCallSelection('Llamada', 'No', false), false);
});

test('a successful new phone contact still requires a verified PBX call', () => {
  assert.equal(requiresPbxCallSelection('Llamada', 'Sí', false), true);
});

test('reprogramming on other channels does not require a PBX call selection', () => {
  assert.equal(requiresPbxCallSelection('WhatsApp', 'No', false), false);
  assert.equal(requiresPbxCallSelection('Email', 'No', false), false);
});

test('editing an existing phone management does not require a new PBX call selection', () => {
  assert.equal(requiresPbxCallSelection('Llamada', 'Sí', true), false);
});
