import {
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../server/supabaseAuth.js';

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
    const assignmentQuery = new URLSearchParams({
      select: 'pais,codigo_cliente,agente_id',
      order: 'pais.asc,codigo_cliente.asc',
      limit: '5000',
    });

    if (context.agent.rol !== 'admin') {
      assignmentQuery.set('agente_id', `eq.${context.agent.id}`);
      const { body: fixedAssignments } = await supabaseRestRequest(
        `asignaciones_cartera_fija?${assignmentQuery}`,
        {},
        context,
      );
      return res.status(200).json({
        success: true,
        agents: [toClientAgent(context.agent)],
        fixedAssignments: Array.isArray(fixedAssignments) ? fixedAssignments : [],
      });
    }

    const query = new URLSearchParams({
      select: 'id,auth_id,nombre,email,telefono,pais,rol,estado,avatar_url,extension_pbx,tasa_efectividad',
      rol: 'eq.agente',
      order: 'pais.asc,nombre.asc',
    });
    const [{ body }, { body: fixedAssignments }] = await Promise.all([
      supabaseRestRequest(`agentes?${query}`, {}, context),
      supabaseRestRequest(`asignaciones_cartera_fija?${assignmentQuery}`, {}, context),
    ]);
    const agents = Array.isArray(body) ? body.map(toClientAgent) : [];
    return res.status(200).json({
      success: true,
      agents,
      fixedAssignments: Array.isArray(fixedAssignments) ? fixedAssignments : [],
    });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
