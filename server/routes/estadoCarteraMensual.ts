import {
  ApiAuthError,
  assertAgentClientAccess,
  assertAgentCountryAccess,
  authenticateAgentRequest,
  getAssignedClientCodes,
  getAssignedClientCodesForAgent,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import {
  verifySanClientMonthPaid,
  scanAssignedPortfolioBalances,
} from '../paymentReconciliation.js';
import {
  filterAgendaCodesByPositiveMora,
  getAgendaRefreshPlan,
} from '../agendaEligibility.js';

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function elSalvadorDateKey(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function elSalvadorMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
}

function chunkCodes(codes: Iterable<string>, size = 100): string[][] {
  const values = [...codes];
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadAgendaRefreshRows(
  country: 'SV' | 'GT',
  month: string,
  assignedCodes: Set<string>,
) {
  const monthlyRows: Array<Record<string, unknown>> = [];
  const clientRows: Array<Record<string, unknown>> = [];
  const codes = [...assignedCodes];
  for (let index = 0; index < codes.length; index += 100) {
    const codeList = codes.slice(index, index + 100).join(',');
    const monthlyParams = new URLSearchParams({
      select: 'codigo_cliente,updated_at,facturas_mes_verificado_en',
      pais: `eq.${country}`,
      mes_periodo: `eq.${month}`,
      codigo_cliente: `in.(${codeList})`,
      limit: '1000',
    });
    const clientParams = new URLSearchParams({
      select: 'codigo,updated_at',
      pais: `eq.${country}`,
      codigo: `in.(${codeList})`,
      limit: '1000',
    });
    const [monthlyResponse, clientResponse] = await Promise.all([
      supabaseRestRequest(`estado_cartera_mensual?${monthlyParams.toString()}`),
      supabaseRestRequest(`clientes?${clientParams.toString()}`),
    ]);
    if (!Array.isArray(monthlyResponse.body) || !Array.isArray(clientResponse.body)) {
      throw new Error('AGENDA_REFRESH_STATUS_INVALID');
    }
    monthlyRows.push(...monthlyResponse.body);
    clientRows.push(...clientResponse.body);
  }
  return { monthlyRows, clientRows };
}

async function loadManagedSummaries(
  country: 'SV' | 'GT',
  month: string,
  assignedCodes: Set<string>,
  agentId: string,
): Promise<Array<Record<string, unknown>>> {
  if (!month || assignedCodes.size === 0) return [];
  const codes = [...assignedCodes];
  const clientRows: Array<{ id: string; codigo: string; nombre?: string }> = [];
  for (let index = 0; index < codes.length; index += 100) {
    const params = new URLSearchParams({
      select: 'id,codigo,nombre',
      pais: `eq.${country}`,
      codigo: `in.(${codes.slice(index, index + 100).join(',')})`,
      limit: '1000',
    });
    const { body } = await supabaseRestRequest(`clientes?${params.toString()}`);
    if (!Array.isArray(body)) throw new Error('MANAGED_CLIENT_LOOKUP_FAILED');
    clientRows.push(...body);
  }

  const codeById = new Map(clientRows.map((row) => [String(row.id), String(row.codigo).trim().toUpperCase()]));
  const nameById = new Map(clientRows.map((row) => [String(row.id), String(row.nombre || '').trim()]));
  const clientIds = [...codeById.keys()];
  if (clientIds.length === 0) return [];
  const summaries: Array<Record<string, unknown>> = [];
  const nextMonth = (() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextNumber = monthNumber === 12 ? 1 : monthNumber + 1;
    return `${nextYear}-${String(nextNumber).padStart(2, '0')}-01`;
  })();
  const monthStartUtc = new Date(`${month}-01T00:00:00-06:00`).toISOString();
  const nextMonthStartUtc = new Date(`${nextMonth}T00:00:00-06:00`).toISOString();

  for (let index = 0; index < clientIds.length; index += 100) {
    const ids = clientIds.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'id,cliente_id,agente_id,tipo_gestion,contacto_exitoso,acuerdo,duracion_llamada_segundos,fecha_limite_pago,monto_comprometido,observaciones,validacion_exitosa,created_at,valores_dinamicos',
        cliente_id: `in.(${ids.join(',')})`,
        agente_id: `eq.${agentId}`,
        validacion_exitosa: 'eq.true',
        order: 'created_at.desc,id.desc',
        limit: '1000',
        offset: String(offset),
      });
      params.set(
        'or',
        `(valores_dinamicos->>periodMonth.eq.${month},and(valores_dinamicos->>scheduledForDate.gte.${month}-01,valores_dinamicos->>scheduledForDate.lt.${nextMonth}),and(created_at.gte.${monthStartUtc},created_at.lt.${nextMonthStartUtc}))`,
      );

      const { body } = await supabaseRestRequest(`bitacora_gestiones?${params.toString()}`);
      if (!Array.isArray(body)) throw new Error('MANAGED_RECORD_LOOKUP_FAILED');
      for (const row of body) {
        const values = row.valores_dinamicos && typeof row.valores_dinamicos === 'object'
          ? row.valores_dinamicos as Record<string, unknown>
          : {};
        const agreement = String(row.acuerdo || '');
        const status = String(values.estado || '');
        const isPayment = values.paymentOutcome === 'payment_received'
          && Boolean(values.paymentDate && values.paymentEvidencePath);
        const isPromise = (agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas')
          && Boolean(row.fecha_limite_pago);

        const clientCode = codeById.get(String(row.cliente_id || ''));
        if (!clientCode) continue;
        // Older saved records may have scheduledForDate but no periodMonth.
        // Use the scheduled date as the authoritative operational month, then
        // fall back to periodMonth and finally the real creation date.
        const scheduledForDate = String(values.scheduledForDate || '').slice(0, 10);
        const recordMonth = scheduledForDate.slice(0, 7)
          || String(values.periodMonth || '').slice(0, 7)
          || elSalvadorDateKey(row.created_at).slice(0, 7);
        if (recordMonth !== month) continue;
        const createdAt = String(row.created_at || '');
        const createdDate = new Date(createdAt);
        const optionalNumber = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined;
          const number = Number(value);
          return Number.isFinite(number) ? number : undefined;
        };
        const pbxCall = values.pbxCall && typeof values.pbxCall === 'object'
          ? values.pbxCall as Record<string, unknown>
          : {};
        summaries.push({
          id: String(row.id || ''),
          clientCode,
          clientName: nameById.get(String(row.cliente_id || '')) || clientCode,
          country,
          agreement,
          outcome: isPayment ? 'payment_received' : isPromise ? 'promise' : 'contact',
          status: status || (isPayment ? 'Resuelto' : 'Contactado'),
          scheduledForDate: scheduledForDate || elSalvadorDateKey(row.created_at),
          createdAt,
          agentId: String(row.agente_id || ''),
          time: Number.isNaN(createdDate.getTime())
            ? ''
            : new Intl.DateTimeFormat('es-SV', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'America/El_Salvador',
              }).format(createdDate),
          channel: String(row.tipo_gestion || ''),
          contactSuccess: String(row.contacto_exitoso || ''),
          durationSeconds: optionalNumber(row.duracion_llamada_segundos)
            ?? optionalNumber(pbxCall.durationSeconds),
          committedAmount: optionalNumber(row.monto_comprometido),
          deadlineDate: row.fecha_limite_pago ? String(row.fecha_limite_pago) : undefined,
          promiseTime: String(values.promiseTime || '') || undefined,
          contactName: String(values.contactName || '') || undefined,
          contactPhone: String(values.contactPhone || '') || undefined,
          contactEmail: String(values.contactEmail || '') || undefined,
          observations: String(row.observaciones || ''),
          aiVerdict: row.validacion_exitosa === true ? 'Válida' : 'Inválida',
          aiScore: optionalNumber(values.aiScore),
          totalDebt: optionalNumber(values.totalDebt),
          callRoundLabel: String(values.callRoundLabel || ''),
          dynamicValues: values,
        });
      }
      if (body.length < 1000) break;
    }
  }

  return summaries;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const body = method === 'POST' ? parseBody(req.body) : {};
    if (method === 'POST' && !body) {
      return res.status(400).json({ success: false, error: 'INVALID_JSON' });
    }
    const requestedCountry = queryValue(method === 'POST' ? body?.pais : req.query?.pais).toUpperCase();
    const country = (requestedCountry || context.agent.pais) as 'SV' | 'GT';
    const month = queryValue(method === 'POST' ? body?.mes : req.query?.mes);

    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    assertAgentCountryAccess(context, country);
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ success: false, error: 'INVALID_MONTH' });
    }

    if (method === 'POST') {
      const clientCode = queryValue(body?.codigo_cliente).trim();
      if (!clientCode || !month) {
        return res.status(400).json({ success: false, error: 'CLIENT_AND_MONTH_REQUIRED' });
      }
      await assertAgentClientAccess(context, country, clientCode);

      const { body: clientRows } = await supabaseRestRequest(
        `clientes?select=id&codigo=eq.${encodeURIComponent(clientCode)}&pais=eq.${country}&limit=1`,
      );
      if (!Array.isArray(clientRows) || clientRows.length === 0) {
        return res.status(404).json({ success: false, error: 'CLIENT_NOT_FOUND' });
      }
      const sanVerification = await verifySanClientMonthPaid(country, clientCode, month);
      if (!sanVerification.verified) {
        return res.status(409).json({ success: false, error: 'CLIENT_HAS_UNPAID_OR_UNVERIFIED_INVOICES' });
      }

      const verifiedAt = new Date().toISOString();
      await supabaseRestRequest(
        'estado_cartera_mensual?on_conflict=pais,codigo_cliente,mes_periodo',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            pais: country,
            codigo_cliente: clientCode,
            mes_periodo: month,
            estado: 'Resuelto',
            monto_recuperado: sanVerification.amount,
            verificado_en: verifiedAt,
            updated_at: verifiedAt,
          }),
        },
      );
      return res.status(200).json({
        success: true,
        recovered: true,
        pais: country,
        codigo_cliente: clientCode,
        mes: month,
      });
    }

    const syncWarnings: string[] = [];
    const states: Array<Record<string, unknown>> = [];
    let managed: Array<Record<string, unknown>> = [];
    let assignedCodesForStates: Set<string> | undefined;
    let agendaRefreshSummary: Record<string, number> | undefined;
    const inspectedAgentId = queryValue(req.query?.agente_id).trim();
    if (inspectedAgentId && context.agent.rol !== 'admin') {
      throw new ApiAuthError('Se requiere un perfil de administrador activo.', 403, 'ADMIN_REQUIRED');
    }
    if (inspectedAgentId) {
      assignedCodesForStates = await getAssignedClientCodesForAgent(context, inspectedAgentId);
    } else if (context.agent.rol !== 'admin') {
      try {
        const assignedCodes = await getAssignedClientCodes(context);
        assignedCodesForStates = assignedCodes;
        if (assignedCodes.size === 0) syncWarnings.push('MANAGED:NO_ASSIGNED_CLIENTS');
      } catch (error) {
        syncWarnings.push(
          `MANAGED:${error instanceof ApiAuthError ? error.code : 'SYNC_FAILED'}`,
        );
      }
    }

    if (
      assignedCodesForStates
      && month >= elSalvadorMonthKey()
      && assignedCodesForStates.size > 0
      && (context.agent.rol !== 'admin' || inspectedAgentId)
    ) {
      try {
        const now = new Date();
        const verifiedAfter = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
        const retryAfter = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        const { monthlyRows, clientRows } = await loadAgendaRefreshRows(
          country,
          elSalvadorMonthKey(now),
          assignedCodesForStates,
        );
        const refreshPlan = getAgendaRefreshPlan(
          assignedCodesForStates,
          monthlyRows,
          clientRows,
          verifiedAfter,
          retryAfter,
        );
        const forceAgendaRefresh = queryValue(req.query?.refreshAgenda) === '1';
        if (refreshPlan.recentlyAttemptedCodes.length > 0 && !forceAgendaRefresh) {
          syncWarnings.push('AGENDA_SYNC:RECENT_FAILURE');
        }
        const codesToRefresh = forceAgendaRefresh
          ? [...refreshPlan.codesToRefresh, ...refreshPlan.recentlyAttemptedCodes]
          : refreshPlan.codesToRefresh;
        if (codesToRefresh.length > 0) {
          const refreshResult = await scanAssignedPortfolioBalances(
            country,
            new Set(codesToRefresh),
          );
          agendaRefreshSummary = {
            attempted: codesToRefresh.length,
            checked: refreshResult.checked,
            unavailable: refreshResult.unavailable,
            moraUpdated: refreshResult.moraUpdated,
          };
          if (
            refreshResult.unavailable > 0
            || refreshResult.moraUpdated < codesToRefresh.length
          ) {
            syncWarnings.push('AGENDA_SYNC:INCOMPLETE');
          }
        }
      } catch {
        syncWarnings.push('AGENDA_SYNC:REFRESH_FAILED');
      }
    }

    if (!inspectedAgentId && context.agent.rol !== 'admin' && assignedCodesForStates) {
      try {
        managed = await loadManagedSummaries(
          country,
          month,
          assignedCodesForStates,
          context.agent.id,
        );
      } catch (error) {
        syncWarnings.push(
          `MANAGED:${error instanceof ApiAuthError ? error.code : 'SYNC_FAILED'}`,
        );
      }
    }

    try {
      const codeScopes = assignedCodesForStates
        ? chunkCodes(assignedCodesForStates)
        : [null];
      for (const codeScope of codeScopes) {
        for (let offset = 0; ; offset += 1000) {
          const params = new URLSearchParams({
            select: 'pais,codigo_cliente,mes_periodo,estado,monto_recuperado,verificado_en',
            pais: `eq.${country}`,
            estado: 'eq.Resuelto',
            order: 'mes_periodo.desc,codigo_cliente.asc',
            limit: '1000',
            offset: String(offset),
          });
          if (month) params.set('mes_periodo', `eq.${month}`);
          if (codeScope) params.set('codigo_cliente', `in.(${codeScope.join(',')})`);
          const { body: page } = await supabaseRestRequest(`estado_cartera_mensual?${params.toString()}`);
          if (!Array.isArray(page)) throw new Error('INVALID_MONTHLY_STATE_RESPONSE');
          states.push(...page);
          if (page.length < 1000) break;
        }
      }
    } catch (error) {
      syncWarnings.push(
        `MONTHLY_STATE:${error instanceof ApiAuthError ? error.code : 'UNAVAILABLE'}`,
      );
    }

    const currentMonth = elSalvadorMonthKey();
    const freshStates = states.filter((state) => {
      if (String(state.mes_periodo || '') !== currentMonth) return true;
      const verifiedAt = Date.parse(String(state.verificado_en || ''));
      return Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= 36 * 60 * 60 * 1000;
    });
    const visibleStates = assignedCodesForStates
      ? freshStates.filter((state) => assignedCodesForStates.has(String(state.codigo_cliente || '').trim().toUpperCase()))
      : context.agent.rol === 'admin' ? freshStates : [];
    let agendaEligibleCodes: string[] = [];
    let agendaEligibleMoraByCode: Record<string, number> = {};
    const priorInvoiceCodes = new Set<string>();
    const historicalPriorInvoiceCodes = new Set<string>();
    let agendaHistoricalEligibleCodes: string[] = [];
    if (month) {
      try {
        const moraVerifiedAfter = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
        const codeScopes = assignedCodesForStates
          ? chunkCodes(assignedCodesForStates)
          : [null];
        for (const codeScope of codeScopes) {
          for (let offset = 0; ; offset += 1000) {
            const params = new URLSearchParams({
              select: 'codigo_cliente,facturas_mes_verificado_en',
              pais: `eq.${country}`,
              mes_periodo: `lt.${month}`,
              tiene_facturas_mes: 'eq.true',
              order: 'codigo_cliente.asc,mes_periodo.desc',
              limit: '1000',
              offset: String(offset),
            });
            if (codeScope) params.set('codigo_cliente', `in.(${codeScope.join(',')})`);
            const { body: page } = await supabaseRestRequest(
              `estado_cartera_mensual?${params.toString()}`,
            );
            if (!Array.isArray(page)) throw new Error('INVALID_AGENDA_ELIGIBILITY_RESPONSE');
            page.forEach((row) => {
              const code = String(row.codigo_cliente || '').trim().toUpperCase();
              if (!code) return;
              historicalPriorInvoiceCodes.add(code);
              const verifiedAt = Date.parse(String(row.facturas_mes_verificado_en || ''));
              if (Number.isFinite(verifiedAt) && verifiedAt >= Date.parse(moraVerifiedAfter)) {
                priorInvoiceCodes.add(code);
              }
            });
            if (page.length < 1000) break;
          }
        }

        const priorInvoiceCodeList = [...historicalPriorInvoiceCodes].filter((code) =>
          !assignedCodesForStates || assignedCodesForStates.has(code)
        );
        const positiveMoraRows: Array<{ codigo?: unknown; dias_mora?: unknown; updated_at?: unknown }> = [];
        for (let index = 0; index < priorInvoiceCodeList.length; index += 100) {
          const params = new URLSearchParams({
            select: 'codigo,dias_mora,updated_at',
            pais: `eq.${country}`,
            codigo: `in.(${priorInvoiceCodeList.slice(index, index + 100).join(',')})`,
            dias_mora: 'gt.0',
            order: 'codigo.asc',
            limit: '1000',
          });
          const { body: page } = await supabaseRestRequest(`clientes?${params.toString()}`);
          if (!Array.isArray(page)) throw new Error('INVALID_AGENDA_MORA_RESPONSE');
          positiveMoraRows.push(...page);
        }
        const historicallyPositiveMoraCodes = new Set(
          positiveMoraRows.map((row) => String(row.codigo || '').trim().toUpperCase()).filter(Boolean),
        );
        agendaHistoricalEligibleCodes = [...historicalPriorInvoiceCodes].filter((code) =>
          historicallyPositiveMoraCodes.has(code)
          && (!assignedCodesForStates || assignedCodesForStates.has(code))
        );
        agendaEligibleCodes = filterAgendaCodesByPositiveMora(
          priorInvoiceCodes,
          positiveMoraRows,
          moraVerifiedAfter,
        );
        const eligibleCodes = new Set(agendaEligibleCodes);
        agendaEligibleMoraByCode = Object.fromEntries(
          positiveMoraRows.flatMap((row) => {
            const code = String(row.codigo || '').trim().toUpperCase();
            const daysArrears = Number(row.dias_mora);
            return eligibleCodes.has(code) && Number.isFinite(daysArrears) && daysArrears > 0
              ? [[code, daysArrears]]
              : [];
          }),
        );
      } catch (error) {
        agendaEligibleCodes = [];
        agendaEligibleMoraByCode = {};
        agendaHistoricalEligibleCodes = [];
        syncWarnings.push(
          `AGENDA_ELIGIBILITY:${error instanceof ApiAuthError ? error.code : 'UNAVAILABLE'}`,
        );
      }
    }
    const visibleAgendaEligibleCodes = assignedCodesForStates
      ? agendaEligibleCodes.filter((code) => assignedCodesForStates?.has(code))
      : context.agent.rol === 'admin' ? agendaEligibleCodes : [];
    const visibleAgendaHistoricalEligibleCodes = assignedCodesForStates
      ? agendaHistoricalEligibleCodes.filter((code) => assignedCodesForStates?.has(code))
      : context.agent.rol === 'admin' ? agendaHistoricalEligibleCodes : [];
    return res.status(200).json({
      success: true,
      states: visibleStates,
      managed,
      agendaEligibleCodes: visibleAgendaEligibleCodes,
      agendaHistoricalEligibleCodes: visibleAgendaHistoricalEligibleCodes,
      agendaEligibleMoraByCode: Object.fromEntries(
        Object.entries(agendaEligibleMoraByCode).filter(([code]) =>
          visibleAgendaEligibleCodes.includes(code)
        ),
      ),
      agendaEligibilityStats: {
        assignedClientCount: assignedCodesForStates?.size ?? null,
        priorInvoiceClientCount: [...priorInvoiceCodes].filter((code) =>
          !assignedCodesForStates || assignedCodesForStates.has(code)
        ).length,
        eligibleClientCount: visibleAgendaEligibleCodes.length,
      },
      ...(agendaRefreshSummary ? { agendaRefreshSummary } : {}),
      syncWarnings: [...new Set(syncWarnings)],
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
