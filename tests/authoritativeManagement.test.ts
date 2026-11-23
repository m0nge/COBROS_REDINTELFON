import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAgendaEligibilityReadWarning,
  getAgendaRefreshReadWarning,
  hasConfirmedAgendaSnapshot,
  getManagementReadWarning,
  getMonthlyStateReadWarning,
} from '../src/utils/authoritativeManagement.ts';

test('blocks the agenda when the managed rows are absent or the server warns of a read failure', () => {
  assert.match(getManagementReadWarning({ states: [] }) || '', /^MANAGED:/);
  assert.match(
    getManagementReadWarning({
      managed: [],
      syncWarnings: ['MANAGED: bitacora query failed'],
    }) || '',
    /^MANAGED:/,
  );
  assert.equal(getManagementReadWarning({ managed: [] }), undefined);
});

test('reuses a confirmed agenda only for the same country, agent, and month', () => {
  assert.equal(hasConfirmedAgendaSnapshot('SV:agent-1:2026-11', 'SV:agent-1:2026-11'), true);
  assert.equal(hasConfirmedAgendaSnapshot('SV:agent-1:2026-11', 'SV:agent-2:2026-11'), false);
  assert.equal(hasConfirmedAgendaSnapshot('SV:agent-1:2026-11', 'SV:agent-1:2026-12'), false);
  assert.equal(hasConfirmedAgendaSnapshot('', 'SV:agent-1:2026-11'), false);
});

test('surfaces incomplete monthly payment state without invalidating verified management rows', () => {
  assert.match(getMonthlyStateReadWarning({ managed: [] }) || '', /^MONTHLY_STATE:/);
  assert.equal(
    getMonthlyStateReadWarning({
      states: [],
      managed: [],
      syncWarnings: ['MONTHLY_STATE: state query failed'],
    }),
    'MONTHLY_STATE: state query failed',
  );
  assert.equal(getMonthlyStateReadWarning({ states: [], managed: [] }), undefined);
});

test('blocks future agenda eligibility when its verified invoice list is missing or stale', () => {
  assert.match(getAgendaEligibilityReadWarning({ states: [] }) || '', /^AGENDA_ELIGIBILITY:/);
  assert.equal(
    getAgendaEligibilityReadWarning({
      agendaEligibleCodes: [],
      agendaEligibleMoraByCode: {},
      syncWarnings: ['AGENDA_ELIGIBILITY:UNAVAILABLE'],
    }),
    'AGENDA_ELIGIBILITY:UNAVAILABLE',
  );
  assert.equal(
    getAgendaEligibilityReadWarning({
      agendaEligibleCodes: [],
      agendaEligibleMoraByCode: {},
    }),
    undefined,
  );
  assert.equal(
    getAgendaEligibilityReadWarning({
      agendaEligibleCodes: [],
      agendaEligibleMoraByCode: {},
      syncWarnings: ['AGENDA_SYNC:INCOMPLETE'],
    }),
    undefined,
  );
  assert.equal(
    getAgendaRefreshReadWarning({
      syncWarnings: ['AGENDA_SYNC:INCOMPLETE'],
    }),
    'AGENDA_SYNC: INCOMPLETE',
  );
});
