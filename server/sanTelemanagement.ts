export type SanTelemanagementInput = {
  clientCode: string;
  clientName: string;
  country: string;
  agentName: string;
  timestamp: string;
  agreement: string;
  contactSuccess?: string;
  channel?: string;
  deadlineDate?: string;
  promiseTime?: string;
  committedAmount?: number;
  recoveredAmount?: number;
  contactPhone?: string;
  contactEmail?: string;
  observations?: string;
  dynamicValues?: Record<string, unknown>;
};

export type SanTelemanagementResult = {
  status: 'saved' | 'failed' | 'skipped';
  httpStatus?: number;
  reason?: 'not_eligible' | 'missing_configuration' | 'request_failed';
};

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKeyInElSalvador(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function formatSanDateTime(date: string, time: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year}${time ? ` ${time}` : ''}`;
}

export function isSanTelemanagementEligible(input: SanTelemanagementInput): boolean {
  const agreement = input.agreement.trim().toLocaleLowerCase();
  const values = input.dynamicValues || {};
  const isPayment = agreement === 'pago realizado'
    || values.paymentOutcome === 'payment_received';
  if (isPayment) {
    return Boolean(
      input.timestamp
      && values.paymentDate
      && values.paymentEvidencePath,
    );
  }
  return agreement === 'promesa de pago'
    && input.contactSuccess?.trim().toLocaleLowerCase().replace('í', 'i') === 'si'
    && Boolean(input.deadlineDate)
    && numberValue(input.committedAmount) > 0;
}

export function buildSanTelemanagementPayload(input: SanTelemanagementInput): Record<string, string | number> | null {
  if (!isSanTelemanagementEligible(input)) return null;

  const values = input.dynamicValues || {};
  const isPayment = input.agreement.trim().toLocaleLowerCase() === 'pago realizado'
    || values.paymentOutcome === 'payment_received';
  const promiseDate = isPayment ? '' : formatSanDateTime(
    text(input.deadlineDate),
    text(input.promiseTime || values.promiseTime),
  );
  return {
    Codigo_Cliente: input.clientCode.trim(),
    Nombre_Cliente: input.clientName.trim(),
    Pais: input.country.trim().toUpperCase(),
    Usuario: input.agentName.trim(),
    Fecha_Inicio: dateKeyInElSalvador(input.timestamp),
    Tipo_Gestion: 200,
    Comentario: text(input.observations),
    Gestionado: 'S',
    Proxima_llamada: promiseDate,
    Monto_Promesa: isPayment ? 0 : numberValue(input.committedAmount),
    Fecha_Promesa: promiseDate,
    Monto_recuperado: isPayment
      ? numberValue(input.recoveredAmount ?? values.paymentSanMonthAmount)
      : 0,
    Correo1: text(input.contactEmail || values.contactEmail),
    Correo2: text(values.contactEmail2 || values.correo2),
    Numero_contacto: text(input.contactPhone || values.contactPhone),
  };
}

export async function sendSanTelemanagement(
  input: SanTelemanagementInput,
): Promise<SanTelemanagementResult> {
  const payload = buildSanTelemanagementPayload(input);
  if (!payload) return { status: 'skipped', reason: 'not_eligible' };

  const apiKey = String(process.env.SAN_TELEGESTION_API_KEY || '').trim();
  if (!apiKey) return { status: 'failed', reason: 'missing_configuration' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://san.red.com.sv/API/InsertarTelegestion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return response.status === 200
      ? { status: 'saved', httpStatus: response.status }
      : { status: 'failed', httpStatus: response.status, reason: 'request_failed' };
  } catch {
    return { status: 'failed', reason: 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
}
