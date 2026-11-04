import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, GestionAuditRecord } from '../src/types.ts';
import type { ScheduledCallSlot } from '../src/utils/moraLogic.ts';
import { buildDailyAgendaDisplaySlots } from '../src/utils/dailyAgendaView.ts';
import { buildDailyAgendaReportRows, createDailyAgendaPrintHtml } from '../src/utils/dailyAgendaReport.ts';

function makeClient(code: string): Client {
  return {
    code,
    name: `Cliente ${code}`,
    country: 'SV',
    totalDebt: 100,
    debtVerified: true,
    daysArrears: 5,
    moraRange: '0-30',
    state: 'Pendiente',
    priority: 'Normal',
    invoiceDate: '',
    dueDate: '',
  };
}

function makeRecord(clientCode: string, timestamp: string, extra: Partial<GestionAuditRecord> = {}): GestionAuditRecord {
  return {
    id: `audit-${clientCode}-${timestamp}`,
    timestamp,
    date: '04 nov. 2026',
    scheduledForDate: '2026-11-04',
    time: timestamp.slice(11, 19),
    agentId: 'agent-1',
    agentName: 'Mirna',
    clientCode,
    clientName: `Cliente ${clientCode}`,
    country: 'SV',
    channel: 'Llamada',
    contactSuccess: 'Sí',
    agreement: 'Promesa de Pago',
    observations: 'Confirmó pago.',
    aiVerdict: 'Válida',
    dynamicValues: {},
    ...extra,
  };
}

function makeSlot(client: Client, turnNumber: number): ScheduledCallSlot {
  return {
    client,
    scheduledDay: 4,
    callRound: 1,
    callRoundLabel: '1ª Llamada',
    turnNumber,
    timeSlot: '09:00 AM',
  };
}

test('keeps managed rows visible and fills the selected day to 40 total entries', () => {
  const allClients = Array.from({ length: 40 }, (_, index) => makeClient(`CL${index + 1}`));
  const completedRecords = [
    makeRecord('CL1', '2026-11-04T14:00:00.000Z'),
    makeRecord('CL2', '2026-11-04T14:15:00.000Z'),
  ];
  const pendingSlots = allClients.slice(2).map((client, index) => makeSlot(client, index + 1));

  const displayed = buildDailyAgendaDisplaySlots(pendingSlots, completedRecords, allClients, 4);

  assert.equal(displayed.length, 40);
  assert.equal(displayed.filter((slot) => slot.management).length, 2);
  assert.equal(displayed.filter((slot) => !slot.management).length, 38);
  assert.deepEqual(new Set(displayed.map((slot) => slot.client.code)).size, 40);
  assert.equal(displayed[0].management?.clientCode, 'CL1');
  assert.equal(displayed[0].client.scheduledDay, 4);
});

test('deduplicates completed clients by using their latest record and never duplicates pending rows', () => {
  const client = makeClient('CL1');
  const duplicatePending = makeSlot(client, 1);
  const records = [
    makeRecord('CL1', '2026-11-04T14:00:00.000Z', { observations: 'Registro anterior' }),
    makeRecord('CL1', '2026-11-04T15:00:00.000Z', { observations: 'Registro final' }),
  ];

  const displayed = buildDailyAgendaDisplaySlots([duplicatePending], records, [client], 4);

  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].management?.observations, 'Registro final');
});

test('exports completed details and safely escapes print report content', () => {
  const client = makeClient('CL1');
  const record = makeRecord('CL1', '2026-11-04T14:00:00.000Z', {
    observations: '<script>alert("x")</script>',
    contactName: 'Ana & Luis',
    contactPhone: '555-0100',
    dynamicValues: {
      paymentDate: '2026-11-04',
      paymentMadeBy: 'Ana',
      paymentEvidenceName: 'recibo.pdf',
      paymentEvidencePath: 'private/path/recibo.pdf',
      scheduledForDate: '2026-11-04',
    },
  });

  const slots = buildDailyAgendaDisplaySlots([], [record], [client], 4);
  const rows = buildDailyAgendaReportRows(slots, 'El Salvador');
  const html = createDailyAgendaPrintHtml(rows, {
    agentName: 'Mirna',
    countryLabel: 'El Salvador',
    dateLabel: '04 de noviembre de 2026',
    dateKey: '2026-11-04',
  });

  assert.equal(rows[0].Estado, 'Gestionado');
  assert.equal(rows[0]['Persona de contacto'], 'Ana & Luis');
  assert.equal(rows[0]['Fecha de pago'], '2026-11-04');
  assert.equal(rows[0].Comprobante, 'recibo.pdf');
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /private\/path/);
});
