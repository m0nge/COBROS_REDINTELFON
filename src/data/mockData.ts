import { Agent, CriticalClient, DynamicField, MessageScript } from '../types';

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'ag-maria',
    name: 'María Rodríguez',
    email: 'maria@red.com.sv',
    phone: '+503 7234-5678',
    pbxExtension: '1021',
    country: 'SV',
    role: 'agente',
    status: 'activo',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    effectivenessRate: 9.5,
    assignedCount: 388,
    managedCount: 37,
    pendingCount: 351,
  },
  {
    id: 'ag-eduardo',
    name: 'Eduardo (Admin)',
    email: 'eduardo@red.com.sv',
    phone: '+503 7000-9999',
    pbxExtension: '1001',
    country: 'SV',
    role: 'admin',
    status: 'activo',
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
    effectivenessRate: 9.5,
    assignedCount: 0,
    managedCount: 0,
    pendingCount: 0,
  },
];

export const INITIAL_DYNAMIC_FIELDS: DynamicField[] = [
  {
    id: 'f-1',
    name: 'tipo_gestion',
    label: 'Tipo de Gestión',
    type: 'dropdown',
    options: ['Llamada', 'WhatsApp', 'Microsoft Teams', 'Email', 'Visita'],
    isRequired: true,
    order: 1,
    isActive: true,
  },
  {
    id: 'f-2',
    name: 'contacto_exitoso',
    label: '¿Contacto exitoso?',
    type: 'yesno',
    options: ['Sí', 'No'],
    isRequired: true,
    order: 2,
    isActive: true,
  },
  {
    id: 'f-3',
    name: 'acuerdo',
    label: 'Acuerdo',
    type: 'dropdown',
    options: ['Promesa de Pago', 'Negociación de Cuotas', 'Sin Acuerdo', 'Disputa de Factura'],
    isRequired: true,
    order: 3,
    isActive: true,
  },
  {
    id: 'f-4',
    name: 'fecha_limite',
    label: 'Fecha límite de pago',
    type: 'date',
    isRequired: true,
    order: 4,
    isActive: true,
  },
  {
    id: 'f-5',
    name: 'monto_comprometido',
    label: 'Monto comprometido',
    type: 'money',
    isRequired: true,
    order: 5,
    isActive: true,
  },
  {
    id: 'f-6',
    name: 'opciones_pago',
    label: 'Opciones de Pago ofrecidas',
    type: 'checkbox',
    options: ['Pago Inmediato con Descuento', '2 Cuotas Quincenales', 'Convenio a 90 días'],
    isRequired: false,
    order: 6,
    isActive: true,
  },
  {
    id: 'f-7',
    name: 'observaciones',
    label: 'Observaciones libres',
    type: 'textarea',
    isRequired: false,
    order: 7,
    isActive: true,
  },
];

export const INITIAL_CRITICAL_CLIENTS: CriticalClient[] = [];

export const INITIAL_MESSAGE_SCRIPTS: MessageScript[] = [
  {
    id: 'script-recordatorio-preventivo',
    title: 'Recordatorio Preventivo de Factura del Mes',
    channel: 'WhatsApp',
    targetAudience: '0-30 días (Preventivo)',
    templateText: `Hola estimado/a {contacto}, le saludamos muy cordialmente de {empresa_nombre}.

Nos comunicamos respecto a la cuenta de su empresa "{nombre_cliente}" (Código: {codigo_cliente}). Le informamos que su factura del mes por un monto de {monto_mes} ya se encuentra disponible para su cancelación antes de su fecha límite del {fecha_corte}.

Agradecemos su valioso apoyo confirmándonos si ya cuenta con la programación de pago o si requiere el comprobante fiscal en PDF.

Quedamos a sus órdenes. PBX: {telefono_pbx} | Gestor: {gestor_comercial}.`,
    createdAt: '2026-10-01',
    isDefault: true,
  },
  {
    id: 'script-mora-leve',
    title: 'Notificación de Mora Activa (Primer Contacto 31-60 Días)',
    channel: 'WhatsApp',
    targetAudience: '31-60 días (Mora Leve)',
    templateText: `Estimado/a {contacto}, reciba un cordial saludo de {empresa_nombre}.

Le contactamos para dar seguimiento a la cuenta de "{nombre_cliente}" ({codigo_cliente}). En nuestros registros presenta un saldo pendiente de {monto_total} con {dias_mora} de mora ({facturas_pendientes_count} factura/s pendiente/s).

Deseamos apoyarle para regularizar su cuenta y evitar interrupciones en sus enlaces dedicados y servicios de telecomunicaciones. ¿Cuándo podríamos agendar la aplicación de su transferencia o pago?

Atentamente,
Departamento de Cobranzas - {empresa_nombre}
PBX: {telefono_pbx}`,
    createdAt: '2026-10-01',
    isDefault: true,
  },
  {
    id: 'script-mora-critica',
    title: 'Aviso Urgente de Suspensión y Mora Crítica (90+ Días)',
    channel: 'WhatsApp',
    targetAudience: '91-120 días (Crítico)',
    templateText: `AVISO DE COBRANZA URGENTE - {empresa_nombre}

Atención: {contacto} / Gerencia de Finanzas
Cliente: {nombre_cliente} ({codigo_cliente})
Saldo Vencido Total: {monto_total}
Días de Mora: {dias_mora} ({facturas_pendientes_count} documentos)
Monto del Mes Actual: {monto_mes}

Le notificamos respetuosamente que su cuenta ha ingresado en fase crítica de mora. Para evitar la suspensión total e irreversible de sus líneas, radioenlaces y el traslado a gestión legal externa, le solicitamos regularizar su pago o formalizar un acuerdo antes de 24 horas.

Favor comunicarse de inmediato a nuestro PBX: {telefono_pbx} con su Gestor Comercial {gestor_comercial}.`,
    createdAt: '2026-10-01',
    isDefault: true,
  },
  {
    id: 'script-correo-formal',
    title: 'Estado de Cuenta y Conciliación por Correo Electrónico',
    channel: 'Email',
    targetAudience: 'Todos',
    templateText: `Estimados señores de {nombre_cliente}:

Por medio de la presente, desde el departamento de Créditos y Cobranzas de {empresa_nombre}, nos dirigimos a ustedes para solicitar su colaboración con la conciliación del saldo pendiente en su cuenta (Código {codigo_cliente}).

Detalle del estado de cuenta al día de hoy:
- Saldo total pendiente: {monto_total}
- Factura del mes en curso: {monto_mes}
- Facturas pendientes: {facturas_pendientes_count}
- Antigüedad de mora: {dias_mora}

Adjuntamos copia de sus DTEs correspondientes. Agradecemos nos remitan el comprobante de transferencia bancaria a este correo para proceder con la debida aplicación en nuestro sistema SAP ERP.

Atentamente,
{gestor_comercial}
Gestión de Cobranzas Corporativas
{empresa_nombre} | PBX: {telefono_pbx}`,
    createdAt: '2026-10-01',
    isDefault: true,
  },
];
