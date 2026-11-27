export type GeneralPortfolioManagementRecord = {
  timestamp?: string | null;
  agreement?: string | null;
  contactSuccess?: string | null;
  deadlineDate?: string | null;
  committedAmount?: number | null;
  aiVerdict?: string | null;
  validationPassed?: boolean | null;
  status?: string | null;
  dynamicValues?: Record<string, unknown> | null;
};

export type GeneralPortfolioManagementBlockReason =
  | 'promise_pending'
  | 'rescheduled_future'
  | null;

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function isValidPromise(record: GeneralPortfolioManagementRecord): boolean {
  const agreement = String(record.agreement || '').trim().toLocaleLowerCase();
  const contact = String(record.contactSuccess || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
  const values = record.dynamicValues || {};
  return (
    (agreement === 'promesa de pago' || agreement === 'negociación de cuotas')
    && record.aiVerdict !== 'Inválida'
    && record.validationPassed !== false
    && contact === 'si'
    && isDateKey(record.deadlineDate)
    && Number(record.committedAmount) > 0
    && values.promiseVerificationStatus !== 'paid'
  );
}

function isVerifiedPayment(record: GeneralPortfolioManagementRecord): boolean {
  const values = record.dynamicValues || {};
  if (values.promiseVerificationStatus === 'paid') return true;
  return (
    record.status === 'Resuelto'
    && (
      String(record.agreement || '').trim().toLocaleLowerCase() === 'pago realizado'
      || values.paymentOutcome === 'payment_received'
    )
    && (
      values.summaryOnly === true
      || (Boolean(values.paymentDate) && Boolean(values.paymentEvidencePath))
    )
  );
}

function recordTime(record: GeneralPortfolioManagementRecord): number {
  const time = Date.parse(String(record.timestamp || ''));
  return Number.isFinite(time) ? time : 0;
}

export function getGeneralPortfolioManagementBlockReason(
  records: Iterable<GeneralPortfolioManagementRecord>,
  todayKey: string,
): GeneralPortfolioManagementBlockReason {
  const ordered = [...records].sort((left, right) => recordTime(left) - recordTime(right));
  let latestPaymentTime = -1;
  let latestPromise: GeneralPortfolioManagementRecord | undefined;

  for (const record of ordered) {
    if (isVerifiedPayment(record)) latestPaymentTime = recordTime(record);
    if (isValidPromise(record) && recordTime(record) > latestPaymentTime) latestPromise = record;
  }

  if (
    latestPromise
    && recordTime(latestPromise) > latestPaymentTime
    && isDateKey(latestPromise.deadlineDate)
    && latestPromise.deadlineDate >= todayKey
  ) {
    return 'promise_pending';
  }

  const latestManagement = ordered.at(-1);
  const values = latestManagement?.dynamicValues || {};
  const rescheduleDate = String(values.rescheduleDate || values.scheduledDate || '').slice(0, 10);
  if (
    latestManagement?.status === 'Reprogramado'
    && isDateKey(rescheduleDate)
    && rescheduleDate > todayKey
  ) {
    return 'rescheduled_future';
  }

  return null;
}
