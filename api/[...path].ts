import estadoCarteraMensualHandler from '../server/routes/estadoCarteraMensual.js';
import contactosCobrosHandler from '../server/routes/contactosCobros.js';
import reclamosHandler from '../server/routes/reclamos.js';
import { runPaymentReconciliation } from '../server/paymentReconciliation.js';
import pagoRealizadoHandler from '../server/routes/pagoRealizado.js';
import adminGestionesHandler from '../server/routes/adminGestiones.js';
import { listPbxCallsHandler, pbxAudioHandler } from '../server/routes/pbxCalls.js';

// Keep these endpoints in one function to stay within Vercel Hobby's function cap.
type Handler = (req: any, res: any) => unknown;

const routeHandlers: Record<string, Handler> = {
  'cartera/estado-mensual': estadoCarteraMensualHandler,
  'cartera/pago-realizado': pagoRealizadoHandler,
  'admin/gestiones': adminGestionesHandler,
  'contactos-cobros': contactosCobrosHandler,
  'reclamos': reclamosHandler,
  'reconciliar-pagos-medianoche': runPaymentReconciliation,
  'reconciliar-pagos-mediodia': runPaymentReconciliation,
  'cron/reconciliar-pagos-medianoche': runPaymentReconciliation,
  'cron/reconciliar-pagos-mediodia': runPaymentReconciliation,
  'pbx/calls': listPbxCallsHandler,
  'pbx/audio': pbxAudioHandler,
};

export default async function handler(req: any, res: any) {
  const rawPath = req.query?.path;
  const dynamicPath = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath || '');
  const urlPath = String(req.url || '').split('?')[0].replace(/^\/api\/?/, '');
  const routePath = (dynamicPath || urlPath).replace(/^\/+|\/+$/g, '');
  const routeHandler = routeHandlers[routePath];

  if (!routeHandler) {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }
  return routeHandler(req, res);
}
