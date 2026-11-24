import {
  ApiAuthError,
  assertAgentClientAccess,
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';
import {
  getPromiseReconciliationMonth,
  getPreviousInvoiceMonth,
  isPromiseVerificationDue,
  verifySanClientPromiseMonth,
} from '../paymentReconciliation.js';

type Country = 'SV' | 'GT';

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getElSalvadorDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    const body = parseBody(req.body);
    if (!body) return res.status(400).json({ success: false, error: 'INVALID_JSON' });

    const country = String(body.pais || '').trim().toUpperCase() as Country;
    const clientCode = String(body.codigo_cliente || '').trim().toUpperCase();
    if ((country !== 'SV' && country !== 'GT') || !/^[A-Z0-9_-]+$/.test(clientCode)) {
      return res.status(400).json({ success: false, error: 'INVALID_CLIENT' });
    }
    await assertAgentClientAccess(context, country, clientCode);

    const clientParams = new URLSearchParams({
      select: 'id',
      pais: `eq.${country}`,
      codigo: `eq.${clientCode}`,
      limit: '1',
    });
    const { body: clients } = await supabaseRestRequest(`clientes?${clientParams}`, {}, context);
    const clientId = Array.isArray(clients) ? String(clients[0]?.id || '') : '';
    if (!clientId) {
      throw new ApiAuthError('No se encontró el cliente en la cartera.', 404, 'CLIENT_NOT_FOUND');
    }

    const promiseParams = new URLSearchParams({
      select: 'id,fecha_limite_pago,created_at,valores_dinamicos',
      cliente_id: `eq.${clientId}`,
      contacto_exitoso: 'eq.Si',
      validacion_exitosa: 'eq.true',
      acuerdo: 'in.("Promesa de Pago","Negociación de Cuotas")',
      fecha_limite_pago: 'not.is.null',
      order: 'created_at.desc,id.desc',
      limit: '1',
    });
    const { body: promiseRows } = await supabaseRestRequest(
      `bitacora_gestiones?${promiseParams}`,
      {},
      context,
    );
    const promise = Array.isArray(promiseRows) ? promiseRows[0] : null;
    if (!promise?.id || !promise.fecha_limite_pago) {
      throw new ApiAuthError('No hay una promesa de pago vigente para corroborar.', 404, 'PROMISE_NOT_FOUND');
    }

    const promiseDate = String(promise.fecha_limite_pago).slice(0, 10);
    const today = getElSalvadorDateKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) {
      throw new ApiAuthError('La fecha de la promesa no es válida.', 409, 'PROMISE_DATE_INVALID');
    }
    if (!isPromiseVerificationDue(promiseDate, today)) {
      return res.status(409).json({
        success: false,
        error: 'PROMISE_NOT_DUE',
        availableOn: new Date(Date.parse(`${promiseDate}T12:00:00Z`) + 86400000).toISOString().slice(0, 10),
      });
    }

    const month = getPromiseReconciliationMonth(promise);
    const invoiceMonth = getPreviousInvoiceMonth(month);
    const verification = await verifySanClientPromiseMonth(country, clientCode, invoiceMonth, today);
    if (verification.status === 'unknown') {
      return res.status(502).json({
        success: false,
        error: 'SAN_VERIFICATION_UNAVAILABLE',
        message: 'SAN no devolvió facturas completas; no se cambió el estado de la promesa.',
      });
    }
    if (verification.status === 'not_due') {
      return res.status(409).json({
        success: false,
        error: 'PROMISE_NOT_DUE',
        reason: 'INVOICE_NOT_DUE',
        message: 'La factura del mes que se está cobrando aún no vence; la promesa no se marcó como incumplida.',
        ...(verification.availableOn ? { availableOn: verification.availableOn } : {}),
      });
    }

    const verifiedAt = new Date().toISOString();
    const recovered = verification.status === 'paid';
    await supabaseRestRequest(
      'estado_cartera_mensual?on_conflict=pais,codigo_cliente,mes_periodo',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          pais: country,
          codigo_cliente: clientCode,
          mes_periodo: month,
          estado: recovered ? 'Resuelto' : 'Pendiente',
          monto_recuperado: recovered ? verification.amount : 0,
          verificado_en: verifiedAt,
          updated_at: verifiedAt,
        }),
      },
      context,
    );

    const values = promise.valores_dinamicos && typeof promise.valores_dinamicos === 'object'
      ? promise.valores_dinamicos as Record<string, unknown>
      : {};
    await supabaseRestRequest(
      `bitacora_gestiones?id=eq.${encodeURIComponent(String(promise.id))}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          valores_dinamicos: {
            ...values,
            promiseVerificationStatus: recovered ? 'paid' : 'unpaid',
            promiseVerifiedAt: verifiedAt,
            promiseVerifiedAmount: recovered ? verification.amount : 0,
          },
        }),
      },
      context,
    );

    return res.status(200).json({
      success: true,
      status: recovered ? 'Cumplido' : 'Vencido',
      pais: country,
      codigo_cliente: clientCode,
      mes: month,
      monto_recuperado: recovered ? verification.amount : 0,
      verificado_en: verifiedAt,
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
