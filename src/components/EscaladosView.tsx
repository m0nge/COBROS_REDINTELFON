import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Country } from '../types';
import { authenticatedApiFetch } from '../services/authService';
import { getElSalvadorDateKey } from '../utils/gestionDates';
import { getEscalationFollowUp, type EscalationManagement } from '../utils/escalations';

interface Escalation {
  id: string;
  clientCode: string;
  clientName: string;
  escalatedByName: string;
  escalatedAt: string;
  debtAtEscalation: number;
  daysArrearsAtEscalation: number;
  reason: string;
  status: string;
  managements: EscalationManagement[];
}

interface EscaladosViewProps {
  currentCountry: Country;
}

const emptyForm = {
  canal: 'Llamada',
  contacto_exitoso: 'Si',
  acuerdo: 'Promesa de Pago',
  fecha_promesa: '',
  monto_comprometido: '',
  observaciones: '',
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-SV', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/El_Salvador',
    }).format(date);
}

export const EscaladosView: React.FC<EscaladosViewProps> = ({ currentCountry }) => {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openCode, setOpenCode] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const currency = currentCountry === 'GT' ? 'Q' : '$';
  const todayKey = getElSalvadorDateKey();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedApiFetch(
        `/api/cartera?action=escalados&pais=${encodeURIComponent(currentCountry)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || `HTTP ${response.status}`);
      setEscalations(payload.escalations as Escalation[]);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los escalados.');
    } finally {
      setLoading(false);
    }
  }, [currentCountry]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const response = await authenticatedApiFetch(
      body.operacion === 'corroborar' ? '/api/cartera?action=corroborar-promesa' : '/api/cartera?action=escalados',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pais: currentCountry, ...body }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || (payload.error === 'PROMISE_NOT_DUE'
        ? `La promesa se puede revisar a partir del ${payload.availableOn || 'día siguiente'}.`
        : 'La operación no se completó.'));
    }
    return payload;
  };

  const run = async (code: string, action: () => Promise<string>) => {
    setBusy(code);
    setNotice('');
    try {
      setNotice(await action());
      await load();
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : 'La operación no se completó.');
    } finally {
      setBusy('');
    }
  };

  const submitManagement = (code: string) => run(code, async () => {
    const isPromise = form.contacto_exitoso === 'Si'
      && (form.acuerdo === 'Promesa de Pago' || form.acuerdo === 'Negociación de Cuotas');
    await post({
      operacion: 'gestionar',
      codigo_cliente: code,
      ...form,
      monto_comprometido: Number(form.monto_comprometido) || 0,
    });
    setOpenCode('');
    setForm(emptyForm);
    return isPromise
      ? `Gestión guardada. La promesa de ${code} queda en seguimiento hasta que se revise.`
      : `Gestión de ${code} guardada.`;
  });

  const verifyPromise = (code: string) => run(code, async () => {
    const payload = await post({ operacion: 'corroborar', codigo_cliente: code });
    return payload.status === 'Cumplido'
      ? `${code}: promesa cumplida en SAN (${currency}${Number(payload.monto_recuperado || 0).toFixed(2)}).`
      : `${code}: la promesa no se cumplió. Sigue escalado.`;
  });

  const closeEscalation = (code: string) => run(code, async () => {
    if (!window.confirm(`¿Cerrar el escalado de ${code}? Ya no aparecerá en esta lista.`)) return '';
    await post({ operacion: 'cerrar', codigo_cliente: code });
    return `Escalado de ${code} cerrado.`;
  });

  const open = escalations.filter((row) => row.status !== 'Cerrado');
  const dueCount = open.filter((row) => getEscalationFollowUp(row.managements, todayKey)?.due).length;

  return (
    <section className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">
            Escalados por gestores · {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Clientes escalados</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Clientes que un gestor intentó gestionar dos veces o más y escaló. Como administrador solo puedes gestionar estos clientes.
            Si registras una promesa, queda aquí y puedes corroborarla en SAN desde el día siguiente a la fecha prometida.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-950/70 text-red-200 border border-red-800/60">
            {open.length} abiertos
          </span>
          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-950/70 text-amber-200 border border-amber-800/60">
            {dueCount} promesas por revisar hoy
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Actualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-blue-800/60 bg-blue-950/40 px-4 py-3 text-xs font-semibold text-blue-200">{notice}</div>
      )}
      {error && (
        <div className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-xs font-semibold text-red-200">{error}</div>
      )}

      {loading && escalations.length === 0 ? (
        <div className="py-16 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : open.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">No hay clientes escalados abiertos.</div>
      ) : (
        <div className="space-y-3">
          {open.map((row) => {
            const followUp = getEscalationFollowUp(row.managements, todayKey);
            const isOpen = openCode === row.clientCode;
            const isPromise = form.contacto_exitoso === 'Si'
              && (form.acuerdo === 'Promesa de Pago' || form.acuerdo === 'Negociación de Cuotas');
            return (
              <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-blue-300">{row.clientCode}</span>
                      <span className="font-semibold text-slate-100">{row.clientName}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-red-950/70 text-red-200 border border-red-800/60">{row.status}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Escalado por <strong className="text-slate-200">{row.escalatedByName}</strong> · {formatDateTime(row.escalatedAt)}
                      {' '}· Deuda {currency}{row.debtAtEscalation.toFixed(2)} · {row.daysArrearsAtEscalation} días de mora
                    </div>
                    {row.reason && <div className="text-xs text-slate-300 mt-1">Motivo: {row.reason}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {followUp && (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                        followUp.status === 'paid'
                          ? 'bg-emerald-950/70 text-emerald-200 border-emerald-800/60'
                          : followUp.due
                            ? 'bg-amber-950/70 text-amber-200 border-amber-700/60'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {followUp.status === 'paid' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
                        {followUp.status === 'paid'
                          ? 'Promesa cumplida'
                          : followUp.status === 'unpaid'
                            ? `Promesa incumplida (${followUp.promiseDate})`
                            : followUp.due
                              ? `Revisar promesa del ${followUp.promiseDate}`
                              : `Promesa ${followUp.promiseDate} · revisar desde ${followUp.reviewFrom}`}
                      </span>
                    )}
                    {followUp && followUp.due && followUp.status !== 'paid' && (
                      <button
                        type="button"
                        disabled={busy === row.clientCode}
                        onClick={() => void verifyPromise(row.clientCode)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-60"
                      >
                        Corroborar en SAN
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setOpenCode(isOpen ? '' : row.clientCode);
                        setForm(emptyForm);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500"
                    >
                      {isOpen ? 'Cancelar' : 'Gestionar'}
                    </button>
                    <button
                      type="button"
                      disabled={busy === row.clientCode}
                      onClick={() => void closeEscalation(row.clientCode)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700"
                    >
                      Cerrar escalado
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
                    <label className="flex flex-col gap-1 text-slate-400">
                      Canal
                      <select value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100">
                        {['Llamada', 'WhatsApp', 'Email', 'Visita'].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-slate-400">
                      ¿Contacto exitoso?
                      <select value={form.contacto_exitoso} onChange={(e) => setForm({ ...form, contacto_exitoso: e.target.value })} className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100">
                        <option value="Si">Sí</option>
                        <option value="No">No</option>
                      </select>
                    </label>
                    {form.contacto_exitoso === 'Si' && (
                      <label className="flex flex-col gap-1 text-slate-400">
                        Acuerdo
                        <select value={form.acuerdo} onChange={(e) => setForm({ ...form, acuerdo: e.target.value })} className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100">
                          {['Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura', 'No Aplica'].map((value) => <option key={value}>{value}</option>)}
                        </select>
                      </label>
                    )}
                    {isPromise && (
                      <>
                        <label className="flex flex-col gap-1 text-slate-400">
                          Fecha de la promesa
                          <input type="date" min={todayKey} value={form.fecha_promesa} onChange={(e) => setForm({ ...form, fecha_promesa: e.target.value })} className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100" />
                        </label>
                        <label className="flex flex-col gap-1 text-slate-400">
                          Monto prometido ({currency})
                          <input type="number" min="0" step="0.01" value={form.monto_comprometido} onChange={(e) => setForm({ ...form, monto_comprometido: e.target.value })} className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100" />
                        </label>
                      </>
                    )}
                    <label className="flex flex-col gap-1 text-slate-400 sm:col-span-3">
                      Observaciones
                      <textarea rows={2} value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className="rounded bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100" />
                    </label>
                    <div className="sm:col-span-3 flex justify-end">
                      <button
                        type="button"
                        disabled={busy === row.clientCode || (isPromise && (!form.fecha_promesa || !(Number(form.monto_comprometido) > 0)))}
                        onClick={() => void submitManagement(row.clientCode)}
                        className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Guardar gestión
                      </button>
                    </div>
                  </div>
                )}

                {row.managements.length > 0 && (
                  <div className="space-y-1.5">
                    {row.managements.map((management) => (
                      <div key={management.id} className="text-[11px] text-slate-300 flex flex-wrap gap-x-3 border-l-2 border-slate-700 pl-2">
                        <span className="text-slate-500">{formatDateTime(management.createdAt)}</span>
                        <span>{management.managedBy || 'Admin'}</span>
                        <span>{management.channel}</span>
                        <span>{management.contactSuccess === 'Si' ? 'Contactado' : 'Sin contacto'}</span>
                        <span className="font-semibold">{management.agreement}</span>
                        {management.promiseDate && (
                          <span>{currency}{management.committedAmount.toFixed(2)} el {management.promiseDate}</span>
                        )}
                        {management.observations && <span className="text-slate-400">“{management.observations}”</span>}
                      </div>
                    ))}
                  </div>
                )}
                {row.managements.length === 0 && (
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Sin gestión del administrador todavía.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
