import { authenticateAgentRequest, respondAuthError } from '../server/supabaseAuth.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agent } = await authenticateAgentRequest(req);
    return res.status(501).json({
      success: false,
      error: 'SYNC_NOT_IMPLEMENTED',
      pais: agent.pais,
      message: 'La actualización manual consulta la cartera autenticada directamente; no se usa un conteo global.',
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
