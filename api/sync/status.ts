import { authenticateAgentRequest, respondAuthError } from '../../server/supabaseAuth.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agent } = await authenticateAgentRequest(req);
    return res.status(200).json({
      success: true,
      isSyncing: false,
      pais: agent.pais,
      syncLog: [`Vista limitada a la cartera de ${agent.pais}.`],
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
