import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHardRefreshUrl,
  cleanHardRefreshUrl,
  HARD_REFRESH_QUERY_PARAM,
} from '../src/utils/hardRefresh.ts';

test('hard refresh busts the document URL cache while preserving route, query, and hash', () => {
  const refreshed = new URL(buildHardRefreshUrl(
    'https://app.example.com/agenda?country=SV#today',
    12345,
  ));

  assert.equal(refreshed.pathname, '/agenda');
  assert.equal(refreshed.searchParams.get('country'), 'SV');
  assert.equal(refreshed.searchParams.get(HARD_REFRESH_QUERY_PARAM), '12345');
  assert.equal(refreshed.hash, '#today');
});

test('removes the one-time hard-refresh parameter after the new document loads', () => {
  assert.equal(
    cleanHardRefreshUrl('https://app.example.com/agenda?country=SV&__hard_refresh=12345#today'),
    'https://app.example.com/agenda?country=SV#today',
  );
});

test('leaves regular URLs unchanged when there is no hard-refresh parameter', () => {
  const url = 'https://app.example.com';
  assert.equal(cleanHardRefreshUrl(url), url);
});
