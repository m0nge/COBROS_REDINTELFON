import {
  authenticateAgentRequest,
  respondAuthError,
  supabaseRestRequest,
} from '../supabaseAuth.js';

type Country = 'SV' | 'GT';
type ContactDraft = {
  nombre?: unknown;
  telefono?: unknown;
  correo?: unknown;
  cargo?: unknown;
};

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lettersOnly(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-zÑñ]/g, '');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agent } = await authenticateAgentRequest(req);
    const body = parseBody(req.body);
    if (!body) return res.status(400).json({ success: false, error: 'INVALID_JSON' });

    const country = getText(body.pais).toUpperCase() as Country;
    const clientCode = getText(body.codigo_cliente);
    const contacts = Array.isArray(body.contactos) ? body.contactos as ContactDraft[] : [];
    if (country !== 'SV' && country !== 'GT') {
      return res.status(400).json({ success: false, error: 'INVALID_COUNTRY' });
    }
    if (agent.rol !== 'admin' && country !== agent.pais) {
      return res.status(403).json({ success: false, error: 'COUNTRY_ACCESS_DENIED' });
    }
    if (!clientCode) {
      return res.status(400).json({ success: false, error: 'CLIENT_REQUIRED' });
    }
    if (contacts.length < 1 || contacts.length > 10) {
      return res.status(400).json({ success: false, error: 'CONTACT_COUNT_INVALID' });
    }

    const normalizedContacts = contacts.map((contact, index) => {
      const nombre = getText(contact?.nombre);
      const telefono = getText(contact?.telefono);
      const correo = getText(contact?.correo);
      const cargo = getText(contact?.cargo);
      const invalidFields: string[] = [];
      if (lettersOnly(nombre).length < 6) invalidFields.push('nombre');
      if (telefono.replace(/\D/g, '').length < 8) invalidFields.push('telefono');
      if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) invalidFields.push('correo');
      if (cargo.length > 120) invalidFields.push('cargo');
      if (invalidFields.length) {
        return { invalid: { index, fields: invalidFields } };
      }
      return {
        value: {
          nombre,
          telefono,
          correo: correo || null,
          cargo: cargo || null,
        },
      };
    });
    const invalidContact = normalizedContacts.find((contact) => 'invalid' in contact);
    if (invalidContact && 'invalid' in invalidContact) {
      return res.status(400).json({
        success: false,
        error: 'CONTACT_VALIDATION_FAILED',
        contact: invalidContact.invalid,
      });
    }

    const clientParams = new URLSearchParams({
      select: 'id',
      codigo: `eq.${clientCode}`,
      pais: `eq.${country}`,
      limit: '1',
    });
    const { body: clientRows } = await supabaseRestRequest(`clientes?${clientParams.toString()}`);
    if (!Array.isArray(clientRows) || clientRows.length === 0) {
      return res.status(404).json({ success: false, error: 'CLIENT_NOT_FOUND' });
    }

    const existingParams = new URLSearchParams({
      select: 'numero_contacto',
      codigo_cliente: `eq.${clientCode}`,
      pais: `eq.${country}`,
      order: 'numero_contacto.desc',
      limit: '1',
    });
    const { body: existingRows } = await supabaseRestRequest(
      `contactos_cobros?${existingParams.toString()}`,
    );
    const maxExistingNumber = Array.isArray(existingRows)
      ? Number(existingRows[0]?.numero_contacto || 0)
      : 0;
    const nextNumber = Math.max(0, maxExistingNumber) + 1;
    if (nextNumber + normalizedContacts.length - 1 > 32767) {
      return res.status(409).json({ success: false, error: 'CONTACT_NUMBER_LIMIT' });
    }

    const rows = normalizedContacts.map((contact, index) => {
      if (!('value' in contact)) return null;
      return {
        codigo_cliente: clientCode,
        pais: country,
        numero_contacto: nextNumber + index,
        nombre: contact.value.nombre,
        cargo: contact.value.cargo,
        telefono_fijo: contact.value.telefono,
        correo: contact.value.correo,
        whatsapp: null,
      };
    });
    if (rows.some((row) => row === null)) {
      return res.status(400).json({ success: false, error: 'CONTACT_VALIDATION_FAILED' });
    }

    const { body: insertedContacts } = await supabaseRestRequest('contactos_cobros', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!Array.isArray(insertedContacts) || insertedContacts.length !== rows.length) {
      return res.status(502).json({ success: false, error: 'CONTACT_SAVE_FAILED' });
    }
    return res.status(201).json({ success: true, contactos: insertedContacts });
  } catch (error) {
    return respondAuthError(res, error);
  }
}
