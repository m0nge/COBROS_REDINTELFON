import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTelephoneNumber } from '../src/utils/phone.ts';

test('removes separators and keeps only digits for the softphone URI', () => {
  assert.equal(sanitizeTelephoneNumber('2255-8888'), '22558888');
  assert.equal(sanitizeTelephoneNumber('(2255) 8888'), '22558888');
});

test('preserves a leading plus for an international phone number', () => {
  assert.equal(sanitizeTelephoneNumber('+503 2255-8888'), '+50322558888');
});

test('does not preserve plus signs unless one starts the number', () => {
  assert.equal(sanitizeTelephoneNumber('503+2255-8888'), '50322558888');
  assert.equal(sanitizeTelephoneNumber('++503 2255'), '+5032255');
});

test('returns an empty value when there are no digits', () => {
  assert.equal(sanitizeTelephoneNumber(null), '');
  assert.equal(sanitizeTelephoneNumber('   '), '');
  assert.equal(sanitizeTelephoneNumber('+()- '), '');
});
