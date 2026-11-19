import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../server/routes/estadoCarteraMensual.ts';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: undefined as Record<string, any> | undefined,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: Record<string, any>) {
      this.payload = payload;
      return this;
    },
  };
}

function monthKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function previousMonthKey(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const previous = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

test('refreshes stale assigned SAN snapshots before calculating agenda eligibility', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const now = new Date();
  const month = monthKey(now);
  const priorMonth = previousMonthKey(month);
  const staleAt = '2026-11-17T10:00:00.000Z';
  const recentAttemptAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const code = 'CL000001';
  const client = {
    id: 'client-1',
    codigo: code,
    nombre: 'Cliente de prueba',
    pais: 'SV',
    dias_mora: 0,
    total_deuda: 0,
    rango_mora: '0-30',
    updated_at: staleAt,
  };
  const rows = new Map<string, Record<string, any>>([
    [`SV:${code}:${month}`, {
      pais: 'SV',
      codigo_cliente: code,
      mes_periodo: month,
      estado: 'Pendiente',
      monto_recuperado: 0,
      verificado_en: staleAt,
      facturas_mes_verificado_en: staleAt,
      updated_at: recentAttemptAt,
    }],
    [`SV:${code}:${priorMonth}`, {
      pais: 'SV',
      codigo_cliente: code,
      mes_periodo: priorMonth,
      estado: 'Pendiente',
      monto_recuperado: 0,
      tiene_facturas_mes: true,
      facturas_mes_verificado_en: staleAt,
      updated_at: staleAt,
    }],
  ]);
  const requests: Array<{ method: string; path: string }> = [];
  const invoices = [
    {
      fechaEmision: `${priorMonth}-10`,
      fechavence: `${priorMonth}-15`,
      estado: 'PENDIENTE',
      valordoc: '100.00',
    },
    {
      fechaEmision: `${month}-01`,
      fechavence: `${month}-05`,
      estado: 'PENDIENTE',
      valordoc: '75.00',
    },
  ];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  process.env.SUPABASE_URL = 'https://supabase.example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    requests.push({ method, path: `${url.host}${url.pathname}${url.search}` });

    if (url.pathname.endsWith('/auth/v1/user')) return json({ id: 'auth-agent' });
    if (url.pathname.endsWith('/rest/v1/agentes')) {
      return json([{
        id: 'agent-1',
        auth_id: 'auth-agent',
        nombre: 'Agent Example',
        email: 'agent@example.invalid',
        pais: 'SV',
        rol: 'agente',
        estado: 'activo',
      }]);
    }
    if (url.pathname.endsWith('/rest/v1/asignaciones_cartera_fija')) {
      return json([{ codigo_cliente: code }]);
    }
    if (url.pathname.endsWith('/rest/v1/clientes')) {
      if (method === 'PATCH') {
        Object.assign(client, JSON.parse(String(init?.body || '{}')));
        return new Response(null, { status: 204 });
      }
      return json([client]);
    }
    if (url.pathname.endsWith('/rest/v1/estado_cartera_mensual')) {
      if (method === 'POST') {
        const postedRows = JSON.parse(String(init?.body || '[]')) as Array<Record<string, any>>;
        postedRows.forEach((row) => {
          rows.set(`${row.pais}:${row.codigo_cliente}:${row.mes_periodo}`, {
            ...rows.get(`${row.pais}:${row.codigo_cliente}:${row.mes_periodo}`),
            ...row,
          });
        });
        return new Response(null, { status: 204 });
      }
      const params = new URLSearchParams(url.search);
      let selected = [...rows.values()];
      const country = params.get('pais')?.replace(/^eq\./, '');
      const monthFilter = params.get('mes_periodo') || '';
      const status = params.get('estado')?.replace(/^eq\./, '');
      const invoiceFlag = params.get('tiene_facturas_mes')?.replace(/^eq\./, '');
      const codeFilter = params.get('codigo_cliente') || '';
      if (country) selected = selected.filter((row) => row.pais === country);
      if (monthFilter.startsWith('eq.')) {
        selected = selected.filter((row) => row.mes_periodo === monthFilter.slice(3));
      } else if (monthFilter.startsWith('lt.')) {
        selected = selected.filter((row) => row.mes_periodo < monthFilter.slice(3));
      }
      if (status) selected = selected.filter((row) => row.estado === status);
      if (invoiceFlag) selected = selected.filter((row) => String(row.tiene_facturas_mes) === invoiceFlag);
      if (codeFilter.startsWith('in.(')) {
        const codes = new Set(codeFilter.slice(4, -1).split(','));
        selected = selected.filter((row) => codes.has(row.codigo_cliente));
      }
      return json(selected);
    }
    if (url.pathname.endsWith('/rest/v1/bitacora_gestiones')) return json([]);
    if (url.hostname === 'san.red.com.sv') return json(invoices);
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
  }) as typeof fetch;

  try {
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer unit-test-agent-session' },
      query: { action: 'estado-mensual', pais: 'SV', mes: month, refreshAgenda: '1' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload?.agendaEligibleCodes, [code]);
    assert.deepEqual(response.payload?.agendaHistoricalEligibleCodes, [code]);
    assert.equal(response.payload?.agendaEligibilityStats.assignedClientCount, 1);
    assert.equal(response.payload?.agendaEligibilityStats.priorInvoiceClientCount, 1);
    assert.equal(response.payload?.agendaEligibilityStats.eligibleClientCount, 1);
    assert.deepEqual(response.payload?.agendaRefreshSummary, {
      attempted: 1,
      checked: 1,
      unavailable: 0,
      moraUpdated: 1,
    });
    assert.ok(Number(client.dias_mora) > 0);
    assert.ok(requests.some((request) => request.path.includes('san.red.com.sv')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});
