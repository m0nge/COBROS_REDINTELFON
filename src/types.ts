export type Country = 'SV' | 'GT';

export type MoraRange = '0-30' | '31-60' | '61-90' | '91-120' | '120+';

export type ManagementState = 'Pendiente' | 'No Contactado' | 'Contactado' | 'Reprogramado' | 'Resuelto' | 'Escalado';

export type Priority = 'Alta' | 'Media' | 'Normal';

export type ManagementType = 'Llamada' | 'WhatsApp' | 'Microsoft Teams' | 'Email' | 'Visita';

export type ContactSuccess = 'Sí' | 'No' | 'Sin respuesta';

export type AgreementType =
  | 'Promesa de Pago'
  | 'Negociación de Cuotas'
  | 'Sin Acuerdo'
  | 'Disputa de Factura'
  | 'No Aplica';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: 'admin' | 'agente';
  country: Country;
  avatarUrl: string;
}

export interface Agent {
  id: string;
  authId?: string | null;
  name: string;
  email: string;
  phone: string;
  pbxExtension: string; // Extensión PBX de 4 dígitos (ej. 1024)
  country: Country;
  role: 'admin' | 'agente';
  status: 'activo' | 'inactivo';
  avatarUrl: string;
  effectivenessRate: number | null; // null when there is no verified measurement
  assignedCount: number;
  managedCount: number;
  pendingCount: number;
}

export interface Client {
  code: string;
  name: string;
  status?: string; // 'ACTIVO' | 'INACTIVO'
  estatus?: string; // 'ACTIVO' | 'INACTIVO'
  isManualAssignment?: boolean;
  address?: string;
  phone1?: string;
  phone2?: string;
  cell?: string;
  celular?: string;
  telefono?: string;
  contactPerson?: string;
  department?: string;
  municipality?: string;
  email?: string;
  classification?: string; // 'PERSONA JURIDICA', 'GOBIERNO', etc.
  salesManager?: string;
  managerEmail?: string;
  managerCode?: string;
  country: Country;
  totalDebt: number;
  debtVerified?: boolean;
  daysArrears: number;
  moraRange: MoraRange;
  state: ManagementState;
  priority: Priority;
  lastManagementDate?: string;
  lastManagementType?: string;
  invoiceDate: string;
  dueDate: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  isFixedAssignment?: boolean;
  scheduledTime?: string;
  scheduledDay?: number; // Día del mes para la siguiente gestión
  scheduledDate?: string;
  callRound?: number; // 1, 2, 3...
  callRoundLabel?: string; // '1ª Llamada (Corte/Preventivo)', '2ª Llamada (Seguimiento)', etc.
  notes?: string;
  managementHistory?: ClientManagementHistoryItem[];
}

export interface PortfolioUploadResult {
  fileName: string;
  fileType: 'excel' | 'pdf' | 'csv' | 'text';
  totalRowsFound: number;
  activeRowsParsed: number;
  inactiveRowsOmitted: number;
  matchedInSapCount: number;
  newClientsCount: number;
  totalDebtCalculated: number;
  clients: Client[];
  unmatchedCodes: string[];
}

export interface ClientManagementHistoryItem {
  id: string;
  date: string;
  time?: string;
  channel: string;
  callRound?: number;
  callRoundLabel?: string;
  contactSuccess: string;
  agreement: string;
  committedAmount?: number;
  deadlineDate?: string;
  promiseTime?: string;
  contactName?: string;
  contactPhone?: string;
  observations: string;
  agentName: string;
  aiVerdict?: 'Válida' | 'Inválida';
  aiScore?: number;
  dynamicValues?: Record<string, unknown>;
  status?: ManagementState;
}

export interface GestionAuditRecord {
  id: string;
  timestamp: string;
  date: string;
  time: string; // Hora exacta con segundos (ej. 08:14:22 AM)
  agentId: string;
  agentName: string;
  agentEmail?: string;
  pbxExtension?: string;
  clientCode: string;
  clientName: string;
  country: Country;
  channel: string;
  durationSeconds?: number;
  contactSuccess: string;
  agreement: string;
  committedAmount?: number;
  deadlineDate?: string;
  promiseTime?: string;
  contactName?: string;
  contactPhone?: string;
  observations: string;
  aiVerdict?: 'Válida' | 'Inválida';
  aiScore?: number;
  totalDebt?: number;
  callRoundLabel?: string;
  dynamicValues?: Record<string, unknown>;
  status?: ManagementState;
}

export interface MessageScript {
  id: string;
  title: string;
  channel: 'WhatsApp' | 'Email' | 'SMS' | 'General';
  targetAudience: 'Todos' | '0-30 días (Preventivo)' | '31-60 días (Mora Leve)' | '61-90 días (Mora Moderada)' | '91-120 días (Crítico)' | '120+ días (Cobranza Judicial)';
  templateText: string;
  createdAt: string;
  updatedAt?: string;
  isDefault?: boolean;
}

export interface PaymentAgreement {
  id: string;
  clientCode: string;
  clientName: string;
  country: Country;
  agreedAmount: number;
  totalDebt: number;
  agreementDate: string;
  promiseDate: string;
  promiseTime?: string;
  contactName?: string;
  status: 'Pendiente' | 'Cumplido' | 'Vencido' | 'Anulado';
  installments?: number;
  agentId: string;
  agentName: string;
  phone?: string;
  notes?: string;
  receiptNumber?: string;
  fulfilledDate?: string;
}

export interface AIEvaluationResult {
  isValid: boolean;
  score: number;
  criteria: {
    coherence: boolean;
    informationQuality: boolean;
    businessAlignment: boolean;
  };
  feedback: string;
  reasons: string[];
  recommendations: string[];
  suggestedAction?: 'aprobar' | 'corregir' | 'reprogramar';
  suggestedRescheduleDate?: string;
}

export interface DailyWorkloadConfig {
  clientsPerDay: number; // Por defecto: 40 al día
  activeDaysRange: number; // Fijo del 1 al 22 del mes
  month: string;
  year: number;
}

export interface SAPPayment {
  id: string;
  date: string;
  amount: number;
  type: 'Parcial' | 'Completo';
}

export interface SANService {
  id: string;
  name: string;
  category: 'Internet Fibra' | 'TV Digital' | 'Telefonía Móvil' | 'Seguro Hogar' | 'Enlace Dedicado' | 'Telefonía Fija';
  icon: string;
  status: string;
}

export interface SANClaim {
  id: string;
  date: string;
  issue: string;
  status: 'Pendiente' | 'Resuelto' | 'En Proceso';
}

export interface SanClientInfo {
  CardCode: string;
  CardName: string;
  contactName?: string;
  CATEGORIA?: string;
  EMAIL?: string;
  VERTICAL?: string;
  INDUSTRIA?: string;
  ACTIVIDADECO?: string;
  GIRO?: string;
  EJECUTIVO?: string;
  COBROS?: string;
  SAC?: string;
  'TOTAL ANEXOS'?: string;
  'ANEXOS BLOQUEADOS'?: string;
  'ANEXOS INHIBIDOS'?: string;
  'ANEXOS BLOQUEADOS E INHIBIDOS'?: string;
  'CLIENTE REDPTT'?: string;
  'CLIENTE ANALOGO'?: string;
  'CLIENTE DATARED'?: string;
  'CLIENTE INFRAESTRUCTURA'?: string;
  'ANEXOS PTT'?: string;
  'ANEXOS ANALOGO'?: string;
  'ANEXOS SIRV'?: string;
  'ANEXOS TRACKER'?: string;
  'ANEXOS IDEN'?: string;
  'TELEFONO 1'?: string;
  'TELEFONO 2'?: string | null;
  'TELEFONO MOVIL'?: string;
  DEPARTAMENTO?: string;
  MUNICIPIO?: string;
  'TELEFONO COBROS'?: string;
  'CORREO COBROS'?: string;
  'CONTACTO COBROS'?: string;
  'TELEFONO SERVICIO AL CLIENTE'?: string;
  'CORREO SERVICIO AL CLIENTE'?: string;
  'CONTACTO SERVICIO AL CLIENTE'?: string | null;
  'TELEFONO REPRESENTANTE LEGAL'?: string;
  'CORREO REPRESENTANTE LEGAL'?: string;
  'CONTACTO REPRESENTANTE LEGAL'?: string | null;
  CLASIFICACION?: string;
  'GESTOR DE COBRO'?: string;
  CLASIFICACION_CLIENTE?: string;
}

export interface SanInvoice {
  DOCENTRY: string;
  DocEntry: string;
  numdoc: string;
  doctype: string;
  fechaEmision: string;
  fechavence: string;
  tipodoc: string;
  valordoc: string;
  VatSum: string;
  valorneto: string;
  ccosto?: string;
  emisor?: string;
  seriefiscal?: string | null;
  numfiscal?: string | null;
  numfiscal2?: string;
  pago: string;
  descuento?: string;
  url?: string;
  Codgen?: string | null;
  num_control?: string | null;
  link_pago?: string | null;
  Fecha_aplica_pago?: string | null;
  estado: 'PAGADO' | 'PENDIENTE' | string;
}

export interface SanAnexoItem {
  anexo: number | string;
  telefono?: string | null;
  flota?: string | null;
  id?: string | null;
  estado?: string;
  folcct?: string;
  folncc?: string;
}

export interface SanAnexosData {
  lineas?: number;
  anexos?: SanAnexoItem[];
}

export interface SanPayment {
  DocEntry: string;
  DocNum: string;
  DocType?: string;
  Canceled?: string;
  DocDate?: string;
  DocDueDate?: string;
  DocTotal?: string | number;
  Comments?: string;
  JrnlMemo?: string;
}

export interface SanClaim {
  correl: number;
  reclamo: string;
  useringr?: string;
  codigocliente?: string;
  nombrecliente?: string;
  fechatrx?: string;
  descripcion?: string;
  asunto?: string;
  tecnologia?: string;
  tipo?: string;
  clase?: string;
  motivo?: string;
  estado?: string;
  tecnico?: string;
  tratadopor?: string;
}

export interface SanEquipment {
  folcod?: number;
  eqpcod?: string;
  eqpser?: string;
  eqpnam?: string;
  trxusr?: string;
  eqptip?: string;
}

export interface SanSummary {
  totalEmitidasCount: number;
  totalEmitidasMonto: number;
  pagadasCount: number;
  pagadasMonto: number;
  pendientesCount: number;
  pendientesMonto: number;
  mesEmitidasCount: number;
  mesEmitidasMonto: number;
  mesPagadasCount: number;
  mesPagadasMonto: number;
  mesPendientesCount: number;
  mesPendientesMonto: number;
  claimsCount: number;
}

export interface RealClient360Data {
  clientCode: string;
  clientName: string;
  country: Country;
  clientInfo: SanClientInfo | null;
  anexosData: SanAnexosData | null;
  invoices: SanInvoice[];
  invoiceDataAvailable?: boolean;
  invoiceBalancesComplete?: boolean;
  claims: SanClaim[];
  payments: SanPayment[];
  equipment: SanEquipment[];
  summary: SanSummary;
}

export interface InteractionHistoryItem {
  id: string;
  date: string;
  type: 'Llamada Saliente' | 'Email Entrante' | 'Visita Técnica' | 'WhatsApp';
  description: string;
}

export interface Client360Data extends RealClient360Data {}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'radio'
  | 'yesno'
  | 'phone'
  | 'email'
  | 'datepicker';

export interface DynamicField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  isRequired: boolean;
  order: number;
  isActive: boolean;
}

export interface ManagementRecord {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  managementType: ManagementType;
  successfulContact: ContactSuccess;
  agreement: AgreementType;
  deadlineDate?: string;
  committedAmount?: number;
  callDurationSeconds: number;
  observations: string;
  dynamicFieldsData: Record<string, any>;
  validationReport: {
    callDurationValid: boolean;
    mandatoryFieldsValid: boolean;
    agreementValid: boolean;
    isSuccess: boolean;
    errorMessage?: string;
  };
}

export interface CriticalClient {
  id: string;
  clientCode: string;
  name: string;
  country: Country;
  totalDebt: number;
  daysArrears: number;
  escalationStatus: 'Pendiente Legal' | 'En Cobranza Judicial' | 'Escalado';
  escalatedAt?: string;
}
