import { runPaymentReconciliation } from '../../server/paymentReconciliation.js';

export default async function handler(req: any, res: any) {
  return runPaymentReconciliation(req, res);
}
