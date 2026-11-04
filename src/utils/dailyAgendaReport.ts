import type { GestionAuditRecord } from '../types';
import type { DailyAgendaDisplaySlot } from './dailyAgendaView';

export type DailyAgendaReportRow = Record<string, string | number>;

const TECHNICAL_DYNAMIC_KEYS = new Set([
  'scheduledfordate',
  'periodmonth',
  'summaryonly',
  'paymentoutcome',
  'paymentevidencepath',
  'paymentevidencemime',
  'paymentevidencesize',
  'contactname',
  'contactphone',
  'contactemail',
  'promisetime',
  'contactchannel',
  'agreementdetails',
  'rescheduledate',
  'scheduleddate',
  'callroundlabel',
  'paymentdate',
  'paymentmadeby',
]);

function valueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Dato no disponible]';
    }
  }
  return String(value);
}

function additionalFields(record?: GestionAuditRecord): string {
  if (!record?.dynamicValues) return '';
  return Object.entries(record.dynamicValues)
    .filter(([key, value]) => !TECHNICAL_DYNAMIC_KEYS.has(key.toLowerCase()) && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${valueText(value)}`)
    .join('\n');
}

export function buildDailyAgendaReportRows(
  slots: DailyAgendaDisplaySlot[],
  countryLabel: string,
): DailyAgendaReportRow[] {
  return slots.map((slot) => {
    const record = slot.management;
    const values = record?.dynamicValues || {};
    const evidenceName = valueText(values.paymentEvidenceName);
    return {
      Turno: slot.turnNumber,
      Hora: record?.time || slot.timeSlot || '',
      'Código Cliente': slot.client.code,
      'Nombre Cliente': record?.clientName || slot.client.name,
      País: countryLabel,
      Estado: record ? 'Gestionado' : 'Pendiente',
      Ronda: slot.callRoundLabel,
      'Días Mora': slot.client.debtVerified === false ? 'Pendiente de consultar en SAN' : Number(slot.client.daysArrears || 0),
      'Saldo SAN': slot.client.debtVerified === false ? 'Pendiente de consultar en SAN' : Number(slot.client.totalDebt || 0),
      Canal: record?.channel || '',
      'Resultado de contacto': record?.contactSuccess || '',
      'Persona de contacto': record?.contactName || valueText(values.contactName),
      Teléfono: record?.contactPhone || valueText(values.contactPhone),
      Correo: record?.contactEmail || valueText(values.contactEmail),
      Acuerdo: record?.agreement || '',
      'Monto comprometido': record?.committedAmount ?? '',
      'Fecha promesa': record?.deadlineDate || '',
      'Hora promesa': valueText(values.promiseTime),
      'Fecha de pago': valueText(values.paymentDate),
      'Persona que pagó': valueText(values.paymentMadeBy),
      Comprobante: evidenceName || (values.paymentEvidencePath ? 'Adjunto' : ''),
      Observaciones: record?.observations || '',
      'Campos adicionales': additionalFields(record),
    };
  });
}

function escapeHtml(value: unknown): string {
  return valueText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createDailyAgendaPrintHtml(
  rows: DailyAgendaReportRow[],
  metadata: {
    agentName: string;
    countryLabel: string;
    dateLabel: string;
    dateKey: string;
  },
): string {
  const managedCount = rows.filter((row) => row.Estado === 'Gestionado').length;
  const pendingCount = rows.length - managedCount;
  const fixedFields = new Set(['Turno', 'Hora', 'Código Cliente', 'Nombre Cliente', 'País', 'Estado']);
  const cards = rows.map((row) => {
    const fields = Object.entries(row)
      .filter(([key, value]) => !fixedFields.has(key) && value !== '')
      .map(([key, value]) => `<div class="field"><strong>${escapeHtml(key)}</strong><div>${escapeHtml(value)}</div></div>`)
      .join('');
    return `
      <article class="record">
        <header>
          <span class="turn">#${escapeHtml(row.Turno)}</span>
          <div class="client">
            <strong>${escapeHtml(row['Código Cliente'])} · ${escapeHtml(row['Nombre Cliente'])}</strong>
            <small>${escapeHtml(row.Hora)} · ${escapeHtml(row.Ronda)}</small>
          </div>
          <span class="state ${row.Estado === 'Gestionado' ? 'done' : 'pending'}">${escapeHtml(row.Estado)}</span>
        </header>
        ${fields ? `<div class="fields">${fields}</div>` : '<p class="empty">Sin detalle de gestión registrado.</p>'}
      </article>`;
  }).join('');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gestión diaria ${escapeHtml(metadata.dateKey)} · ${escapeHtml(metadata.agentName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; color: #172033; background: #eef2f7; font: 12px/1.45 Arial, sans-serif; }
    main { max-width: 1000px; margin: auto; }
    .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin: 0 0 18px; }
    button { border: 0; border-radius: 6px; padding: 9px 14px; color: #fff; background: #1d4ed8; font-weight: 700; cursor: pointer; }
    button.secondary { color: #334155; background: #e2e8f0; }
    h1 { margin: 0; font-size: 22px; }
    .meta { margin: 5px 0 14px; color: #475569; }
    .totals { display: flex; gap: 12px; margin-bottom: 18px; }
    .total { border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px 12px; background: #fff; }
    .record { margin: 0 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; background: #fff; break-inside: avoid; }
    .record header { display: flex; align-items: flex-start; gap: 10px; }
    .turn { min-width: 32px; color: #1d4ed8; font-weight: 700; }
    .client { flex: 1; }
    .client small { display: block; margin-top: 2px; color: #64748b; }
    .state { border-radius: 999px; padding: 3px 8px; font-weight: 700; white-space: nowrap; }
    .state.done { color: #047857; background: #d1fae5; }
    .state.pending { color: #1d4ed8; background: #dbeafe; }
    .fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px 12px; margin: 10px 0 0 42px; }
    .field { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .field strong { display: block; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
    .empty { margin: 8px 0 0 42px; color: #64748b; }
    @page { size: letter portrait; margin: 12mm; }
    @media print {
      body { padding: 0; background: #fff; font-size: 10px; }
      .toolbar { display: none; }
      .record { border-color: #cbd5e1; }
      main { max-width: none; }
    }
    @media (max-width: 650px) { body { padding: 14px; } .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-left: 0; } }
  </style>
</head>
<body>
  <main>
    <div class="toolbar"><button onclick="window.print()">Imprimir / Guardar como PDF</button><button class="secondary" onclick="window.close()">Cerrar</button></div>
    <h1>Lista de gestión diaria</h1>
    <p class="meta">${escapeHtml(metadata.dateLabel)} · ${escapeHtml(metadata.countryLabel)} · ${escapeHtml(metadata.agentName)}</p>
    <div class="totals"><div class="total"><strong>${rows.length}</strong> clientes</div><div class="total"><strong>${managedCount}</strong> gestionados</div><div class="total"><strong>${pendingCount}</strong> pendientes</div></div>
    ${cards || '<p>No hay registros para esta fecha.</p>'}
  </main>
</body>
</html>`;
}
