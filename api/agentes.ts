import {
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../server/supabaseAuth';

function toClientAgent(row: any) {
  return {
    id: row.id,
    authId: row.auth_id || null,
    name: row.nombre,
    email: row.email,
    phone: row.telefono || '',
    pbxExtension: row.extension_pbx || '',
    country: row.pais,
    role: row.rol,
    status: row.estado,
    avatarUrl: row.avatar_url || '',
    effectivenessRate: row.tasa_efectividad == null ? null : Number(row.tasa_efectividad),
    assignedCount: 0,
    managedCount: 0,
    pendingCount: 0,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (String(req.method || '').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const context = await authenticateAgentRequest(req);
    if (context.agent.rol !== 'admin') {
      return res.status(200).json({ success: true, agents: [toClientAgent(context.agent)] });
    }

    const query = new URLSearchParams({
      select: 'id,auth_id,nombre,email,telefono,pais,rol,estado,avatar_url,extension_pbx,tasa_efectividad',
      rol: 'eq.agente',
      order: 'pais.asc,nombre.asc',
    });
    const { body } = await supabaseRestRequest(`agentes?${query}`, {}, context);
    const agents = Array.isArray(body) ? body.map(toClientAgent) : [];
    return res.status(200).json({ success: true, agents });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
