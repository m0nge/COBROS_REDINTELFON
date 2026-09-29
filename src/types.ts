export type Country = 'SV' | 'GT';

export type MoraRange = '0-30' | '31-60' | '61-90' | '91-120' | '120+';

export type ManagementState = 'Pendiente' | 'No Contactado' | 'Resuelto' | 'Escalado';

export type Priority = 'Alta' | 'Media' | 'Normal';

export type ManagementType = 'Llamada' | 'WhatsApp' | 'Email' | 'Visita';

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
  name: string;
  email: string;
  phone: string;
  pbxExtension: string; // Extensión PBX de 4 dígitos (ej. 1024)
  country: Country;
  role: 'admin' | 'agente';
  status: 'activo' | 'inactivo';
  avatarUrl: string;
  effectivenessRate: number; // e.g. 87.5
  assignedCount: number;
  managedCount: number;
  pendingCount: number;
}

export interface Client {
  code: string;
  name: string;
  address?: string;
  phone1?: string;
  phone2?: string;
  cell?: string;
  celular?: string;
  department?: string;
  municipality?: string;
  email?: string;
  classification?: string; // 'PERSONA JURIDICA', 'GOBIERNO', etc.
  salesManager?: string;
  managerEmail?: string;
  managerCode?: string;
  country: Country;
  totalDebt: number;
  daysArrears: number;
  moraRange: MoraRange;
  state: ManagementState;
  priority: Priority;
  lastManagementDate?: string;
  lastManagementType?: string;
  invoiceDate: string;
  dueDate: string;
  assignedAgentId?: string;
  scheduledTime?: string;
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

export interface InteractionHistoryItem {
  id: string;
  date: string;
  type: 'Llamada Saliente' | 'Email Entrante' | 'Visita Técnica' | 'WhatsApp';
  description: string;
}

export interface Client360Data {
  clientCode: string;
  clientName: string;
  country: Country;
  sap: {
    totalDebt: number;
    phone: string;
    email: string;
    lastPayments: SAPPayment[];
  };
  san: {
    contractedServices: SANService[];
    recentClaims: SANClaim[];
  };
  history: InteractionHistoryItem[];
}

export interface DynamicField {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'dropdown' | 'checkbox' | 'datepicker';
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
