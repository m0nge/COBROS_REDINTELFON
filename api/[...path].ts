import estadoCarteraMensualHandler from '../server/routes/estadoCarteraMensual.js';
import contactosCobrosHandler from '../server/routes/contactosCobros.js';
import reclamosHandler from '../server/routes/reclamos.js';
import { runPaymentReconciliation } from '../server/paymentReconciliation.js';

// Keep these endpoints in one function to stay within Vercel Hobby's function cap.
type Handler = (req: any, res: any) => unknown;

const routeHandlers: Record<string, Handler> = {
  'cartera/estado-mensual': estadoCarteraMensualHandler,
  'contactos-cobros': contactosCobrosHandler,
  'reclamos': reclamosHandler,
  'cron/reconciliar-pagos-medianoche': runPaymentReconciliation,
  'cron/reconciliar-pagos-mediodia': runPaymentReconciliation,
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
