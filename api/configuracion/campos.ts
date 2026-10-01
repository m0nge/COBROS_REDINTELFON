// Vercel Serverless Function: Dynamic Fields Configuration
let dynamicFieldsConfig = [
  { id: 'f-1', name: 'Observaciones de la Gestión', type: 'textarea', required: false, enabled: true, options: [] },
  { id: 'f-2', name: 'Opciones de Pago ofrecidas', type: 'text', required: false, enabled: true, options: [] },
  { id: 'f-3', name: 'Motivo de No Pago', type: 'select', required: false, enabled: true, options: ['Falta de Liquidez', 'Disconformidad con Factura', 'Promesa de Pago Próxima Semana', 'Trámite Administrativo / Retenciones', 'Problemas Técnicos con Servicio'] },
  { id: 'f-4', name: 'Requiere Reclamo Técnico', type: 'boolean', required: false, enabled: true, options: [] },
  { id: 'f-5', name: 'Contacto Alternativo Verificado', type: 'text', required: false, enabled: true, options: [] },
];

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { fields } = req.body || {};
    if (Array.isArray(fields)) {
      dynamicFieldsConfig = fields;
    }
    return res.status(200).json({ success: true, message: 'Campos actualizados', fields: dynamicFieldsConfig });
  }

  return res.status(200).json({ success: true, fields: dynamicFieldsConfig });
}
