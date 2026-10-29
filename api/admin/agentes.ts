import type { AgentProfileRow } from '../../server/supabaseAuth';
import {
  ApiAuthError,
  authenticateAgentRequest,
  respondAuthError,
  supabaseAuthAdminRequest,
  supabaseRestRequest,
} from '../../server/supabaseAuth';

const PROFILE_COLUMNS = 'id,auth_id,nombre,email,telefono,pais,rol,estado,avatar_url,extension_pbx,tasa_efectividad';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_COUNTRIES = new Set(['SV', 'GT']);

function safeAgent(row: AgentProfileRow) {
  return {
    id: row.id,
    authId: row.auth_id,
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

async function findAgent(id: string, context: any) {
  const query = new URLSearchParams({
    select: PROFILE_COLUMNS,
    id: `eq.${id}`,
    rol: 'eq.agente',
    limit: '1',
  });
  const { body } = await supabaseRestRequest(`agentes?${query}`, {}, context);
  const agent = Array.isArray(body) ? body[0] as AgentProfileRow | undefined : undefined;
  if (!agent) throw new ApiAuthError('Agent profile not found.', 404, 'AGENT_NOT_FOUND');
  return agent;
}

async function patchAgent(id: string, updates: Record<string, unknown>, context: any) {
  const query = new URLSearchParams({
    id: `eq.${id}`,
    select: PROFILE_COLUMNS,
  });
  const { body } = await supabaseRestRequest(`agentes?${query}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(updates),
  }, context);
  const agent = Array.isArray(body) ? body[0] as AgentProfileRow | undefined : undefined;
  if (!agent) throw new ApiAuthError('Agent profile was not updated.', 404, 'AGENT_NOT_FOUND');
  return agent;
}

async function hasRelatedRecords(agentId: string, context: any) {
  const tables = [
    'asignaciones_cartera',
    'asignaciones_cartera_fija',
    'bitacora_gestiones',
    'escalaciones_criticas',
  ];
  for (const table of tables) {
    const query = new URLSearchParams({ select: 'id', agente_id: `eq.${agentId}`, limit: '1' });
    const { body } = await supabaseRestRequest(`${table}?${query}`, {}, context);
    if (Array.isArray(body) && body.length > 0) return true;
  }
  return false;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const context = await authenticateAgentRequest(req, true);
    const method = String(req.method || '').toUpperCase();

    if (method === 'GET') {
      const query = new URLSearchParams({
        select: PROFILE_COLUMNS,
        rol: 'eq.agente',
        order: 'pais.asc,nombre.asc',
      });
      const { body } = await supabaseRestRequest(`agentes?${query}`, {}, context);
      const agents = Array.isArray(body) ? body.map(safeAgent) : [];
      return res.status(200).json({ success: true, agents });
    }

    if (method === 'PATCH') {
      const body = req.body || {};
      const id = String(body.id || '');
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: 'INVALID_AGENT_ID' });
      }
      const agent = await findAgent(id, context);

      if (body.action === 'status') {
        const status = String(body.status || '');
        if (status !== 'activo' && status !== 'inactivo') {
          return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
        }
        const updated = await patchAgent(id, { estado: status, updated_at: new Date().toISOString() }, context);
        if (agent.auth_id) {
          try {
            await supabaseAuthAdminRequest(`/${encodeURIComponent(agent.auth_id)}`, {
              method: 'PUT',
              body: JSON.stringify({ ban_duration: status === 'inactivo' ? '876000h' : 'none' }),
            }, context);
          } catch {
            await patchAgent(id, { estado: agent.estado, updated_at: new Date().toISOString() }, context);
            throw new ApiAuthError('The access status could not be synchronized; the profile change was reverted.', 502, 'AUTH_STATUS_UPDATE_FAILED');
          }
        }
        return res.status(200).json({ success: true, agent: safeAgent(updated) });
      }

      if (body.action !== 'update') {
        return res.status(400).json({ success: false, error: 'INVALID_ACTION' });
      }

      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const phone = String(body.phone || '').trim();
      const country = String(body.country || '').trim().toUpperCase();
      const pbxExtension = String(body.pbxExtension || '').trim();
      const password = typeof body.password === 'string' ? body.password : '';

      if (name.length < 3 || name.length > 120) {
        return res.status(400).json({ success: false, error: 'INVALID_NAME', message: 'El nombre debe tener entre 3 y 120 caracteres.' });
      }
      if (!EMAIL_PATTERN.test(email) || email.length > 150) {
        return res.status(400).json({ success: false, error: 'INVALID_EMAIL', message: 'Ingresa un correo válido.' });
      }
      if (!VALID_COUNTRIES.has(country)) {
        return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
      }
      if (country !== agent.pais) {
        const fixedAssignmentQuery = new URLSearchParams({
          select: 'id',
          agente_id: `eq.${agent.id}`,
          limit: '1',
        });
        const { body: fixedAssignments } = await supabaseRestRequest(
          `asignaciones_cartera_fija?${fixedAssignmentQuery}`,
          {},
          context,
        );
        if (Array.isArray(fixedAssignments) && fixedAssignments.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'AGENT_HAS_FIXED_PORTFOLIO',
            message: 'No se puede cambiar el país mientras tenga cartera fija. Primero actualiza la asignación en la tabla de cartera.',
          });
        }
      }
      if (pbxExtension && !/^\d{4}$/.test(pbxExtension)) {
        return res.status(400).json({ success: false, error: 'INVALID_EXTENSION', message: 'La extensión debe tener 4 dígitos.' });
      }
      if (phone.length > 30) {
        return res.status(400).json({ success: false, error: 'INVALID_PHONE' });
      }
      if (password && (password.length < 10 || password.length > 72)) {
        return res.status(400).json({ success: false, error: 'INVALID_PASSWORD', message: 'La contraseña nueva debe tener entre 10 y 72 caracteres.' });
      }

      const updates = {
        nombre: name,
        email,
        telefono: phone || null,
        pais: country,
        extension_pbx: pbxExtension || null,
        updated_at: new Date().toISOString(),
      };

      if (!agent.auth_id && password) {
        const created = await supabaseAuthAdminRequest('', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { agent_id: agent.id },
          }),
        }, context);
        const authId = String(created?.user?.id || created?.id || '');
        if (!UUID_PATTERN.test(authId)) {
          throw new ApiAuthError('The authentication account was not created.', 502, 'AUTH_ACCOUNT_CREATE_FAILED');
        }
        try {
          const updated = await patchAgent(id, { ...updates, auth_id: authId }, context);
          return res.status(200).json({ success: true, agent: safeAgent(updated), accountCreated: true });
        } catch (error) {
          try {
            await supabaseAuthAdminRequest(`/${encodeURIComponent(authId)}`, { method: 'DELETE' }, context);
          } catch {
            // The profile update failed; the new account has no linked profile and cannot access the app.
          }
          throw error;
        }
      }

      const previousProfileValues = {
        nombre: agent.nombre,
        email: agent.email,
        telefono: agent.telefono,
        pais: agent.pais,
        extension_pbx: agent.extension_pbx,
        updated_at: new Date().toISOString(),
      };
      const updated = await patchAgent(id, updates, context);

      if (agent.auth_id && (email !== agent.email || password)) {
        try {
          const authUpdates: Record<string, unknown> = { email, email_confirm: true };
          if (password) authUpdates.password = password;
          await supabaseAuthAdminRequest(`/${encodeURIComponent(agent.auth_id)}`, {
            method: 'PUT',
            body: JSON.stringify(authUpdates),
          }, context);
        } catch {
          try {
            await patchAgent(id, previousProfileValues, context);
          } catch {
            // Keep the original safe error response; the profile can be reconciled by an admin.
          }
          throw new ApiAuthError('The authentication account could not be updated; profile changes were rolled back where possible.', 502, 'AUTH_ACCOUNT_UPDATE_FAILED');
        }
      }

      return res.status(200).json({
        success: true,
        agent: safeAgent(updated),
        accountLinked: Boolean(agent.auth_id),
      });
    }

    if (method === 'DELETE') {
      const id = String(req.body?.id || '');
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: 'INVALID_AGENT_ID' });
      }
      const agent = await findAgent(id, context);
      if (await hasRelatedRecords(agent.id, context)) {
        return res.status(409).json({
          success: false,
          error: 'AGENT_HAS_HISTORY',
          message: 'Este agente tiene asignaciones, gestiones o auditoría. Desactívalo para conservar el historial.',
        });
      }

      const query = new URLSearchParams({ id: `eq.${id}`, rol: 'eq.agente' });
      await supabaseRestRequest(`agentes?${query}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }, context);

      let authAccountDeleted = true;
      if (agent.auth_id) {
        try {
          await supabaseAuthAdminRequest(`/${encodeURIComponent(agent.auth_id)}`, { method: 'DELETE' }, context);
        } catch {
          authAccountDeleted = false;
        }
      }
      return res.status(200).json({ success: true, authAccountDeleted });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
