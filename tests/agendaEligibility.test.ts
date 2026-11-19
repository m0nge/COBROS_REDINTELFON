import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterAgendaCodesByPositiveMora,
  getAgendaRefreshPlan,
} from '../server/agendaEligibility.ts';

test('agenda requires both a prior unpaid invoice and positive mora days', () => {
  assert.deepEqual(
    filterAgendaCodesByPositiveMora(
      ['cl-current-only', 'cl-zero-mora', 'cl-overdue', 'CL-OVERDUE'],
      [
        { codigo: 'CL-CURRENT-ONLY', dias_mora: 0, updated_at: '2026-11-12T15:00:00Z' },
        { codigo: 'cl-zero-mora', dias_mora: '0', updated_at: '2026-11-12T15:00:00Z' },
        { codigo: 'cl-overdue', dias_mora: '1', updated_at: '2026-11-12T15:00:00Z' },
        { codigo: 'cl-other-overdue', dias_mora: 42, updated_at: '2026-11-12T15:00:00Z' },
        { codigo: 'cl-stale-overdue', dias_mora: 45, updated_at: '2026-11-10T15:00:00Z' },
        { codigo: 'cl-unknown', dias_mora: null, updated_at: '2026-11-12T15:00:00Z' },
      ],
      '2026-11-11T15:00:00Z',
    ),
    ['CL-OVERDUE'],
  );
});

test('agenda refresh retries stale SAN snapshots but reports recent failed attempts', () => {
  assert.deepEqual(
    getAgendaRefreshPlan(
      ['fresh', 'recent-failure', 'stale', 'missing', 'STALE'],
      [
        {
          codigo_cliente: 'fresh',
          updated_at: '2026-11-19T08:00:00Z',
          facturas_mes_verificado_en: '2026-11-19T08:00:00Z',
        },
        {
          codigo_cliente: 'recent-failure',
          updated_at: '2026-11-19T11:00:00Z',
          facturas_mes_verificado_en: '2026-11-17T11:00:00Z',
        },
        {
          codigo_cliente: 'stale',
          updated_at: '2026-11-18T10:00:00Z',
          facturas_mes_verificado_en: '2026-11-17T10:00:00Z',
        },
      ],
      [
        { codigo: 'fresh', updated_at: '2026-11-19T08:00:00Z' },
        { codigo: 'recent-failure', updated_at: '2026-11-17T10:00:00Z' },
        { codigo: 'stale', updated_at: '2026-11-18T10:00:00Z' },
      ],
      '2026-11-18T12:00:00Z',
      '2026-11-19T06:00:00Z',
    ),
    {
      codesToRefresh: ['STALE', 'MISSING'],
      recentlyAttemptedCodes: ['RECENT-FAILURE'],
    },
  );
});
