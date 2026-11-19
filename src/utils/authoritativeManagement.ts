export function getManagementReadWarning(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return 'MANAGED: respuesta de bitácora inválida';
  }

  const body = payload as { managed?: unknown; syncWarnings?: unknown };
  if (!Array.isArray(body.managed)) {
    return 'MANAGED: no se recibieron gestiones desde el servidor';
  }

  const warnings = Array.isArray(body.syncWarnings)
    ? body.syncWarnings.map(String)
    : [];
  return warnings.find((warning) => warning.startsWith('MANAGED:'));
}

export function getMonthlyStateReadWarning(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return 'MONTHLY_STATE: respuesta mensual inválida';
  }

  const body = payload as { states?: unknown; syncWarnings?: unknown };
  const warnings = Array.isArray(body.syncWarnings)
    ? body.syncWarnings.map(String)
    : [];
  return warnings.find((warning) => warning.startsWith('MONTHLY_STATE:'))
    || (!Array.isArray(body.states) ? 'MONTHLY_STATE: no se recibieron estados del servidor' : undefined);
}

export function getAgendaEligibilityReadWarning(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return 'AGENDA_ELIGIBILITY: respuesta de elegibilidad inválida';
  }

  const body = payload as {
    agendaEligibleCodes?: unknown;
    agendaEligibleMoraByCode?: unknown;
    syncWarnings?: unknown;
  };
  const warnings = Array.isArray(body.syncWarnings)
    ? body.syncWarnings.map(String)
    : [];
  const refreshWarning = warnings.find((warning) => warning.startsWith('AGENDA_SYNC:'));
  if (refreshWarning) return `AGENDA_SYNC: ${refreshWarning.slice('AGENDA_SYNC:'.length)}`;
  return warnings.find((warning) => warning.startsWith('AGENDA_ELIGIBILITY:'))
    || (!Array.isArray(body.agendaEligibleCodes)
      ? 'AGENDA_ELIGIBILITY: no se recibieron clientes verificados'
      : !body.agendaEligibleMoraByCode
        || typeof body.agendaEligibleMoraByCode !== 'object'
        || Array.isArray(body.agendaEligibleMoraByCode)
        ? 'AGENDA_ELIGIBILITY: no se recibieron saldos de mora verificados'
        : undefined);
}
