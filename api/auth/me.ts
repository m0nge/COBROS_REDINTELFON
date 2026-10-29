import { authenticateAgentRequest, respondAuthError } from '../_lib/supabaseAuth';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agent } = await authenticateAgentRequest(req);
    return res.status(200).json({
      success: true,
      user: {
        id: agent.id,
        username: agent.email.split('@')[0],
        name: agent.nombre,
        email: agent.email,
        role: agent.rol,
        country: agent.pais,
        avatarUrl: agent.avatar_url || '',
      },
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
