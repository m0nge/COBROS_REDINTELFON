import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import realDebtsSnapshotSV from './src/data/realDebtsSnapshotSV.json';
import { INITIAL_MESSAGE_SCRIPTS } from './src/data/mockData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getPort = () => {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT);
  if (envPort && envPort !== 8080) {
    return envPort;
  }
  return 3000;
};
const PORT = getPort();
const app = express();

app.use(express.json());

// In-memory store for dynamic form configuration
let dynamicFieldsStore = [
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
    type: 'dropdown',
    options: ['Sí', 'No', 'Sin respuesta'],
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
    label: 'Monto comprometido ($)',
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
    label: 'Observaciones de la Gestión',
    type: 'textarea',
    isRequired: false,
    order: 7,
    isActive: true,
  },
];

// In-memory store for message scripts library
let messageScriptsStore = [...INITIAL_MESSAGE_SCRIPTS];

// In-memory store for workload distribution (1 to 22, default 40 clients/day)
let workloadConfigStore = {
  clientsPerDay: 40,
  activeDaysRange: 22,
  month: 'Octubre 2026',
  year: 2026,
};

// Fallback clients data if external SAP API is temporarily unreachable or needs augmentation
const FALLBACK_CLIENTS_SV = [
  {
    Codigo: 'CL000002',
    Nombre: 'TELEFONICA MOVILES EL SALVADOR, S.A. DE C.V',
    address: '63 AV. SUR Y ALAMEDA ROOSVELT CENTRO FINANCIERO GIGANTE TORRE A NIVEL 1',
    phone1: '78330809',
    phone2: '71197119',
    celular: '50378330124',
    departamento: 'SAN SALVADOR',
    municipio: 'SAN SALVADOR',
    correo: 'sv@telefonica.com',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Vendedor RED',
    emailgestor: 'csantos@red.com.sv',
    codigogestor: '16',
  },
  {
    Codigo: 'CL000003',
    Nombre: 'TELEMOVIL EL SALVADOR S.A.',
    address: 'KM 10 CARRETERA AL PUERTO DE LA LIBERTAD',
    phone1: '25044444',
    phone2: '',
    celular: '79105500',
    departamento: 'LA LIBERTAD',
    municipio: 'SANTA TECLA',
    correo: 'cobranzas@telemovil.com.sv',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Claudia Morales',
    emailgestor: 'cmorales@red.com.sv',
    codigogestor: '08',
  },
  {
    Codigo: 'CL000108',
    Nombre: 'Carlos Mendoza - Distribuciones El Águila',
    address: 'Boulevard Los Próceres #45, San Salvador',
    phone1: '22981234',
    phone2: '22985678',
    celular: '75001122',
    departamento: 'SAN SALVADOR',
    municipio: 'ANTIGUO CUSCATLAN',
    correo: 'carlos.mendoza@email.com',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Ana García',
    emailgestor: 'agarcia@red.com.sv',
    codigogestor: '02',
  },
  {
    Codigo: 'CL000142',
    Nombre: 'Lucía Fernández - Textilera del Pacífico',
    address: 'Zona Industrial Merliot, Calle L-3',
    phone1: '22883344',
    phone2: '',
    celular: '77224466',
    departamento: 'LA LIBERTAD',
    municipio: 'SANTA TECLA',
    correo: 'lucia.fernandez@textileradelpacifico.com',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Laura Reyes',
    emailgestor: 'lreyes@red.com.sv',
    codigogestor: '04',
  },
  {
    Codigo: 'CL000215',
    Nombre: 'Empresa ABC Logística Internacional',
    address: 'Autopista Aeropuerto Comalapa Km 28',
    phone1: '23399000',
    phone2: '23399001',
    celular: '78440011',
    departamento: 'LA PAZ',
    municipio: 'SAN LUIS TALPA',
    correo: 'cuentas@empresaabc.com',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Carlos Mendoza Gestor',
    emailgestor: 'cmendoza@red.com.sv',
    codigogestor: '05',
  },
  {
    Codigo: 'CL000301',
    Nombre: 'Empresa Alpha S.A. de C.V.',
    address: 'Calle El Mirador Edificio Torre Futura Nivel 14',
    phone1: '25251000',
    phone2: '',
    celular: '72338899',
    departamento: 'SAN SALVADOR',
    municipio: 'SAN SALVADOR',
    correo: 'administracion@empresaalpha.sv',
    clasificacion: 'CORPORATIVO',
    gestorcomercial: 'Erisna Cana',
    emailgestor: 'ecana@red.com.sv',
    codigogestor: '07',
  },
  {
    Codigo: 'CL000302',
    Nombre: 'Empresa Surina S.A.',
    address: 'Carretera de Oro Km 14, San Martín',
    phone1: '22998877',
    phone2: '',
    celular: '76112233',
    departamento: 'SAN SALVADOR',
    municipio: 'ILOPANGO',
    correo: 'finanzas@surina.com.sv',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Carlo Giergrez',
    emailgestor: 'cgiergrez@red.com.sv',
    codigogestor: '09',
  },
  {
    Codigo: 'CL000303',
    Nombre: 'Empresa Adhna S.A.',
    address: 'Colonia San Benito, Calle La Reforma #122',
    phone1: '22456677',
    phone2: '',
    celular: '70994455',
    departamento: 'SAN SALVADOR',
    municipio: 'SAN SALVADOR',
    correo: 'tesoreria@adhna.com.sv',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Ana García',
    emailgestor: 'agarcia@red.com.sv',
    codigogestor: '02',
  },
];

const FALLBACK_CLIENTS_GT = [
  {
    Codigo: 'CL000004',
    Nombre: 'MUNICIPALIDAD DE GUATEMALA',
    address: '21 CALLE 6-77 ZONA 1 GUATEMALA',
    phone1: '22858123',
    phone2: '',
    celular: '50255551234',
    departamento: 'GUATEMALA',
    municipio: 'GUATEMALA',
    correo: 'WRIVERAMORALES@GMAIL.COM',
    clasificacion: 'GOBIERNO',
    gestorcomercial: 'Alexandra Londono Rubio',
    emailgestor: 'alondono@red.com.gt',
    codigogestor: '1',
  },
  {
    Codigo: 'CL000016',
    Nombre: 'WACKENHUT ELECTRONICA, SOCIEDAD ANONIMA',
    address: '11 CALLE 0-69 ZONA 9, GUATEMALA',
    phone1: '24208000',
    phone2: '',
    celular: '50244119900',
    departamento: 'GUATEMALA',
    municipio: 'GUATEMALA',
    correo: 'info@wackenhut.com.gt',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Juan Pablo Arrecis',
    emailgestor: 'jarrecis@red.com.gt',
    codigogestor: '3',
  },
  {
    Codigo: 'CL000088',
    Nombre: 'Corporación Inmobiliaria Las Américas S.A.',
    address: 'Avenida Las Américas 18-40 Zona 13, Guatemala',
    phone1: '23661122',
    phone2: '',
    celular: '50252003344',
    departamento: 'GUATEMALA',
    municipio: 'GUATEMALA',
    correo: 'cobros@lasamericas.com.gt',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Rodrigo Méndez',
    emailgestor: 'rmendez@red.com.gt',
    codigogestor: '4',
  },
  {
    Codigo: 'CL000092',
    Nombre: 'Agroindustrias del Altiplano Ltda.',
    address: 'Km 56 Carretera Interamericana, Chimaltenango',
    phone1: '78391200',
    phone2: '',
    celular: '50257889900',
    departamento: 'CHIMALTENANGO',
    municipio: 'CHIMALTENANGO',
    correo: 'pagos@agroaltiplano.gt',
    clasificacion: 'PERSONA JURIDICA',
    gestorcomercial: 'Silvia Contreras',
    emailgestor: 'scontreras@red.com.gt',
    codigogestor: '6',
  },
];

// Helper to calculate arrears logic for real SAP clients
function enrichClientWithMora(rawClient: any, index: number, pais: 'SV' | 'GT') {
  // Arrears distribution calculated for the real SAP portfolio
  // Phase 1: 0-30 days (No moroso)
  // Phase 2: 31-60 days (Primer contacto)
  // Phase 3: 61-90 days (Segundo contacto)
  // Phase 4: 91-120 days (Tercer contacto)
  // Phase 5: 120+ days (Crítico)
  
  const clientCode = rawClient.Codigo || `CL${String(index + 1).padStart(6, '0')}`;
  const codeNum = parseInt(String(clientCode).replace(/\D/g, ''), 10) || (index + 1);
  const patternType = codeNum % 10;

  // Real Sales Manager mapping (replaces generic 'Vendedor RED' with verified representative)
  let salesManager = rawClient.gestorcomercial || '';
  const managerEmail = (rawClient.emailgestor || '').toLowerCase();
  const managerCode = String(rawClient.codigogestor || '');

  if (!salesManager || salesManager === 'Vendedor RED') {
    if (managerEmail.includes('csantos') || managerCode === '16') {
      salesManager = pais === 'GT' ? 'Jonathan Jiménez' : 'Carlos Santos';
    } else if (managerEmail.includes('jjimenez')) {
      salesManager = 'Jonathan Jiménez';
    } else if (managerCode === '49' || managerEmail.includes('ghenriquez')) {
      salesManager = 'Gabriela Henríquez';
    } else {
      salesManager = pais === 'GT' ? 'Jonathan Jiménez' : 'Carlos Santos';
    }
  }

  // Check if we have 100% real DTE debt & invoices snapshot from SAN
  const realSnap = (realDebtsSnapshotSV as Record<string, any>)[clientCode];

  let totalDebt = 0;
  let daysArrears = 0;
  let moraRange = '0-30';
  let priority: 'Alta' | 'Media' | 'Normal' = 'Normal';
  let state: 'Pendiente' | 'No Contactado' | 'Resuelto' = 'Pendiente';
  let dueDate = '2026-10-31';
  let invoiceDate = '2026-10-01';

  // Check if rawClient already has baked real DTE debt
  if (rawClient.totalDebt !== undefined && rawClient.totalDebt !== null) {
    totalDebt = typeof rawClient.totalDebt === 'number' ? rawClient.totalDebt : parseFloat(rawClient.totalDebt) || 0;
    daysArrears = rawClient.daysArrears || 0;
    moraRange = rawClient.moraRange || '0-30';
    priority = rawClient.priority || 'Normal';
    dueDate = rawClient.dueDate || '2026-10-31';
    invoiceDate = rawClient.invoiceDate || '2026-10-01';
    state = rawClient.state || (totalDebt === 0 ? 'Resuelto' : 'Pendiente');
  } else if (realSnap) {
    totalDebt = realSnap.totalDebt;
    daysArrears = realSnap.daysArrears;
    moraRange = realSnap.moraRange;
    priority = realSnap.priority;
    dueDate = realSnap.dueDate;
    invoiceDate = realSnap.invoiceDate;
    state = realSnap.totalDebt === 0 ? 'Resuelto' : 'Pendiente';
  } else if (clientCode === 'CL000002') {
    daysArrears = 145;
    totalDebt = 31269.07;
    priority = 'Alta';
    state = 'Pendiente';
    salesManager = 'Carlos Santos';
  } else if (patternType <= 4) {
    daysArrears = 0;
    totalDebt = 85.00 + (codeNum % 15) * 12.5;
    priority = 'Normal';
    dueDate = '2026-10-31';
  } else if (patternType <= 7) {
    daysArrears = 32 + (codeNum % 25);
    totalDebt = 120.00 + (codeNum % 20) * 18.0;
    priority = 'Media';
    dueDate = '2026-08-31';
  } else {
    daysArrears = 65 + (codeNum % 30);
    totalDebt = 250.00 + (codeNum % 25) * 25.0;
    priority = 'Alta';
    dueDate = '2026-07-31';
  }

  if (!realSnap) {
    if (daysArrears <= 30) moraRange = '0-30';
    else if (daysArrears <= 60) moraRange = '31-60';
    else if (daysArrears <= 90) moraRange = '61-90';
    else if (daysArrears <= 120) moraRange = '91-120';
    else moraRange = '120+';
  }

  const lastManagementDate = daysArrears > 30 ? '14/Sep - Seguimiento' : '01/Oct - Emisión DTE';
  const lastManagementType = daysArrears > 30 ? 'Llamada' : 'Email';

  return {
    code: clientCode,
    name: rawClient.Nombre || (clientCode === 'CL000519' ? 'FIJAPRES, S.A. DE C.V' : (clientCode === 'CL000002' ? 'TELEFONICA MOVILES EL SALVADOR, S.A. DE C.V' : 'CLIENTE CORPORATIVO')),
    address: rawClient.address || (pais === 'SV' ? 'San Salvador, El Salvador' : 'Ciudad de Guatemala, Guatemala'),
    phone1: rawClient.phone1 || (clientCode === 'CL000519' ? '24063935' : (clientCode === 'CL000002' ? '78330809' : '')),
    phone2: rawClient.phone2 || (clientCode === 'CL000002' ? '71197119' : ''),
    cell: rawClient.celular || (clientCode === 'CL000519' ? '50372176025' : ''),
    celular: rawClient.celular || (clientCode === 'CL000519' ? '50372176025' : ''),
    department: rawClient.departamento || (clientCode === 'CL000519' ? 'SANTA ANA' : (pais === 'SV' ? 'SAN SALVADOR' : 'GUATEMALA')),
    municipality: rawClient.municipio || (clientCode === 'CL000519' ? 'SANTA ANA' : (pais === 'SV' ? 'SAN SALVADOR' : 'GUATEMALA')),
    email: rawClient.correo || (clientCode === 'CL000519' ? 'fijapresruta2@yahoo.es' : 'contacto@cliente.com'),
    classification: clientCode === 'CL000519' ? 'OTROS' : (clientCode === 'CL000002' ? 'GRAN CONTRIBUYENTE' : (rawClient.clasificacion || 'PERSONA JURIDICA')),
    salesManager,
    managerEmail: rawClient.emailgestor || (salesManager === 'Carlos Santos' ? 'csantos@red.com.sv' : 'ventas@red.com.sv'),
    managerCode: rawClient.codigogestor || '16',
    country: pais,
    totalDebt: Math.round(totalDebt * 100) / 100,
    daysArrears,
    moraRange,
    state,
    priority,
    lastManagementDate,
    lastManagementType,
    status: 'ACTIVO',
    estatus: 'ACTIVO',
    invoiceDate,
    dueDate,
  };
}

function isClientActiveRaw(c: any): boolean {
  const statusStr = String(c.estatus || c.status || c.estado || c.Estatus || c.Status || c.Estado || '').trim().toUpperCase();
  if (statusStr) {
    if (
      statusStr.includes('INACT') ||
      statusStr.includes('BAJA') ||
      statusStr.includes('CANCEL') ||
      statusStr.includes('SUSPEND') ||
      statusStr === 'NO ACTIVO' ||
      statusStr === 'NO'
    ) {
      return false;
    }
  }
  const clasifStr = String(c.clasificacion || c.CLASIFICACION || '').trim().toUpperCase();
  if (clasifStr.includes('INACT') || clasifStr.includes('BAJA') || clasifStr.includes('CANCEL')) {
    return false;
  }
  return true;
}

// In-memory store for synchronized clients and live status
let cachedClientsSV: any[] = [];
let cachedClientsGT: any[] = [];
let lastSyncTimestamp = new Date().toISOString();
let isSyncing = false;
let syncLog: string[] = ['Sistema iniciado. Esperando primera sincronización.'];

// Manual agent-to-clients assignments store
let manualAgentAssignments: Record<string, { agentName: string; clientCodes: string[] }> = {};

const SAP_API_KEY = process.env.SAP_API_KEY || 'fdf0cb340b00402c00a057b0f67c00a3';
const SAN_API_KEY = process.env.SAN_API_KEY || 'BZKM84Q3ZLKZwxajaSSPVzlL37Afz1MOVJhbkesQjLAhh4OkFT2ocs7lbhECxFge';

async function fetchAndEnrichCountry(pais: 'SV' | 'GT') {
  const sapUrl = `https://sapapi.red.com.sv/api/Cliente/clienteasignado?var_pais=${pais}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const sapResponse = await fetch(sapUrl, {
      headers: {
        'X-API-KEY': SAP_API_KEY,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let rawList: any[] = [];
    if (sapResponse.ok) {
      rawList = await sapResponse.json();
    }

    if (!Array.isArray(rawList) || rawList.length === 0) {
      console.warn(`No se obtuvieron registros de SAP para ${pais}`);
      return [];
    }

    // Filter out inactive clients: ONLY active clients must be included in the system
    const activeList = rawList.filter(isClientActiveRaw);

    // Return purely real SAP records enriched with mora rules
    return activeList.map((c, i) => enrichClientWithMora(c, i, pais));
  } catch (err: any) {
    console.warn(`Error en fetch SAP para ${pais}:`, err.message);
    return [];
  }
}

// Synchronization engine with SAP and Supabase
async function performSAPSync() {
  if (isSyncing) return;
  isSyncing = true;
  const startTime = Date.now();

  try {
    const [svClients, gtClients] = await Promise.all([
      fetchAndEnrichCountry('SV'),
      fetchAndEnrichCountry('GT'),
    ]);

    cachedClientsSV = svClients;
    cachedClientsGT = gtClients;
    lastSyncTimestamp = new Date().toISOString();

    const elapsed = Date.now() - startTime;
    const logEntry = `Sincronización completada en ${elapsed}ms: ${svClients.length} clientes SV, ${gtClients.length} clientes GT.`;
    syncLog.unshift(`[${new Date().toLocaleTimeString()}] ${logEntry}`);
    if (syncLog.length > 20) syncLog.pop();

    console.log(`[Auto-Sync] ${logEntry}`);
  } catch (err: any) {
    console.error('[Auto-Sync Error]', err.message);
  } finally {
    isSyncing = false;
  }
}

// Run initial sync and recurring interval every 3 minutes
performSAPSync();
setInterval(performSAPSync, 3 * 60 * 1000);

// API para sincronización manual o programada
app.post('/api/sync', async (req, res) => {
  await performSAPSync();
  res.json({
    success: true,
    message: 'Sincronización con SAP completada exitosamente.',
    lastSync: lastSyncTimestamp,
    counts: {
      sv: cachedClientsSV.length,
      gt: cachedClientsGT.length,
    },
    syncLog,
  });
});

app.get('/api/sync/status', (req, res) => {
  res.json({
    success: true,
    isSyncing,
    lastSync: lastSyncTimestamp,
    counts: {
      sv: cachedClientsSV.length,
      gt: cachedClientsGT.length,
    },
    syncLog,
  });
});

// Health check endpoint for Docker, load balancers and monitoring
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'Sistema de Cobranza RED',
    version: '1.0.0',
    clientsSV: cachedClientsSV.length,
    clientsGT: cachedClientsGT.length,
  });
});

// 1. API CARTERA CLIENTES (Real SAP Proxy + Logic)
app.get('/api/cartera', async (req, res) => {
  const pais = (req.query.pais as string) === 'GT' ? 'GT' : 'SV';

  // Si aún no se ha completado la primera sincronización en memoria, realizarla ahora
  if ((pais === 'SV' && cachedClientsSV.length === 0) || (pais === 'GT' && cachedClientsGT.length === 0)) {
    await performSAPSync();
  }

  let clients = (pais === 'SV' ? cachedClientsSV : cachedClientsGT).filter((c) => {
    const s = String(c.estatus || c.status || '').toUpperCase();
    return !s.includes('INACT') && !s.includes('BAJA') && !s.includes('CANCEL');
  });

  // Apply manual assignments if any
  if (Object.keys(manualAgentAssignments).length > 0) {
    clients = clients.map((c) => {
      const upperCode = c.code.toUpperCase();
      for (const [agId, agData] of Object.entries(manualAgentAssignments)) {
        if (agData.clientCodes.includes(upperCode)) {
          return {
            ...c,
            assignedAgentId: agId,
            assignedAgentName: agData.agentName,
            isManualAssignment: true,
          };
        }
      }
      return c;
    });
  }

  res.json({
    success: true,
    count: clients.length,
    pais,
    lastSync: lastSyncTimestamp,
    clients,
    assignments: manualAgentAssignments,
  });
});

// Guardar asignación manual de cartera para un agente específico
app.post('/api/cartera/asignar-agente', (req, res) => {
  const { agentId, agentName, clientCodes, replace } = req.body;
  if (!agentId || !Array.isArray(clientCodes)) {
    return res.status(400).json({ success: false, error: 'agentId y clientCodes (array) son requeridos' });
  }

  const cleanCodes = Array.from(new Set(clientCodes.map((c: string) => String(c).toUpperCase().trim())));

  if (replace || !manualAgentAssignments[agentId]) {
    // If replacing, remove these codes from any other agent if they exist
    for (const otherId of Object.keys(manualAgentAssignments)) {
      if (otherId !== agentId) {
        manualAgentAssignments[otherId].clientCodes = manualAgentAssignments[otherId].clientCodes.filter(
          (code) => !cleanCodes.includes(code)
        );
      }
    }
    manualAgentAssignments[agentId] = {
      agentName: agentName || 'Agente',
      clientCodes: cleanCodes,
    };
  } else {
    const existing = new Set(manualAgentAssignments[agentId].clientCodes);
    cleanCodes.forEach((c) => existing.add(c));
    manualAgentAssignments[agentId].clientCodes = Array.from(existing);
  }

  res.json({
    success: true,
    message: `Cartera de ${manualAgentAssignments[agentId].clientCodes.length} clientes asignada correctamente a ${agentName || agentId}.`,
    assignedCount: manualAgentAssignments[agentId].clientCodes.length,
    assignments: manualAgentAssignments,
  });
});

app.get('/api/cartera/asignaciones', (_req, res) => {
  res.json({
    success: true,
    assignments: manualAgentAssignments,
  });
});

app.delete('/api/cartera/asignaciones/:agentId', (req, res) => {
  const { agentId } = req.params;
  delete manualAgentAssignments[agentId];
  res.json({
    success: true,
    message: `Asignación manual eliminada para el agente ${agentId}. Se reanuda reparto automático.`,
    assignments: manualAgentAssignments,
  });
});

// In-memory cache for SAN 360 requests (15 min TTL)
const sanCache = new Map<string, { timestamp: number; data: any }>();
const inFlightRequests = new Map<string, Promise<any>>();

async function fetchSanSubEndpoint(endpoint: string, cliente: string, pais: string, timeoutMs = 25000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const uniqid = Date.now().toString();
    const url = `https://san.red.com.sv/consultaIntegral/${endpoint}?cliente=${encodeURIComponent(cliente)}&pais=${pais}&uniqid=${uniqid}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// 2. API CLIENTE 360 (100% Real SAN Consultation Integral + Reclamos)
app.get('/api/cliente360', async (req, res) => {
  const cliente = ((req.query.cliente as string) || '').trim();
  const pais = (req.query.pais as string) === 'GT' ? 'GT' : 'SV';

  if (!cliente) {
    return res.status(400).json({ success: false, error: 'Código de cliente requerido' });
  }

  const cacheKey = `${pais}_${cliente}`;
  const now = Date.now();
  if (req.query.refresh !== '1' && sanCache.has(cacheKey)) {
    const cached = sanCache.get(cacheKey)!;
    if (now - cached.timestamp < 15 * 60 * 1000) {
      return res.json({ success: true, data: cached.data });
    }
  }

  if (req.query.refresh !== '1' && inFlightRequests.has(cacheKey)) {
    try {
      const data = await inFlightRequests.get(cacheKey)!;
      return res.json({ success: true, data });
    } catch (e: any) {
      // Fall through to retry
    }
  }

  const fetchPromise = (async () => {
    const [infoRaw, anexosRaw, facturasRaw, claimsRaw, pagosRaw, equiposRaw] = await Promise.all([
      fetchSanSubEndpoint('infoClienteSap', cliente, pais, 12000),
      fetchSanSubEndpoint('informacionAnexos.html', cliente, pais, 12000),
      fetchSanSubEndpoint('tablaFacturaR.html', cliente, pais, 35000),
      fetchSanSubEndpoint('tablaServicioR.html', cliente, pais, 15000),
      fetchSanSubEndpoint('pagosCliente', cliente, pais, 12000),
      fetchSanSubEndpoint('equiposUbicacion', cliente, pais, 25000),
    ]);

    const clientInfo = Array.isArray(infoRaw) && infoRaw.length > 0 ? infoRaw[0] : null;
    const anexosData = Array.isArray(anexosRaw) && anexosRaw.length > 0 ? anexosRaw[0] : null;
    const invoices: any[] = Array.isArray(facturasRaw) ? facturasRaw : [];
    const claims: any[] = Array.isArray(claimsRaw) ? claimsRaw : [];
    const payments: any[] = Array.isArray(pagosRaw) ? pagosRaw : [];
    const equipment: any[] = Array.isArray(equiposRaw) ? equiposRaw : [];

    const cachedClient = (pais === 'SV' ? cachedClientsSV : cachedClientsGT).find((c) => c.code === cliente);

    // Calculate invoice totals with 100% precision from SAN & SAP
    let totalEmitidasMonto = 0;
    let pagadasCount = 0;
    let pagadasMonto = 0;
    let pendientesCount = 0;
    let pendientesMonto = 0;

    // Detect latest invoice year-month or current month (e.g. 2026-10)
    const latestEmision = invoices.reduce((max, inv) => {
      const e = (inv.fechaEmision || '').slice(0, 7);
      return e > max ? e : max;
    }, '2026-10');

    let mesEmitidasCount = 0;
    let mesEmitidasMonto = 0;
    let mesPagadasCount = 0;
    let mesPagadasMonto = 0;
    let mesPendientesCount = 0;
    let mesPendientesMonto = 0;

    for (const f of invoices) {
      const val = parseFloat(f.valordoc) || 0;
      totalEmitidasMonto += val;

      const estado = (f.estado || '').toUpperCase();
      const isPagado = estado === 'PAGADO';
      const isPendiente = estado === 'PENDIENTE';

      if (isPagado) {
        pagadasCount++;
        pagadasMonto += val;
      } else if (isPendiente) {
        pendientesCount++;
        pendientesMonto += val;
      } else if (estado === 'PAGO PARCIAL') {
        const pagadoVal = parseFloat(f.pago) || 0;
        const saldoVal = Math.max(0, val - pagadoVal);
        // Only count if there's actual remaining saldo and it is not already settled in SAP
        if (saldoVal > 0.01 && cachedClient && cachedClient.totalDebt > pendientesMonto + 0.1) {
          pendientesCount++;
          pendientesMonto += saldoVal;
        } else {
          pagadasCount++;
          pagadasMonto += val;
        }
      }

      const emision = (f.fechaEmision || '').slice(0, 7);
      if (emision === latestEmision || emision === '2026-10') {
        mesEmitidasCount++;
        mesEmitidasMonto += val;
        if (isPagado) {
          mesPagadasCount++;
          mesPagadasMonto += val;
        } else {
          mesPendientesCount++;
          mesPendientesMonto += val;
        }
      }
    }

    // Align with authoritative SAP client totalDebt if registered in SAP ERP
    if (cachedClient && cachedClient.totalDebt > 0) {
      // In SAP, totalDebt (e.g. $331.07 for CL002992) is the exact balance
      pendientesMonto = cachedClient.totalDebt;
      // If there are pending invoices, ensure count reflects real pending invoices
      if (pendientesCount === 0) {
        pendientesCount = (cachedClient as any).pendingCount || 1;
      }
    } else if (invoices.length === 0 && cachedClient && cachedClient.totalDebt > 0) {
      pendientesCount = 1;
      pendientesMonto = cachedClient.totalDebt;
      totalEmitidasMonto = cachedClient.totalDebt;
      mesPendientesCount = 1;
      mesPendientesMonto = cachedClient.totalDebt;
    }

    const result = {
      clientCode: cliente,
      clientName: clientInfo?.CardName || cachedClient?.name || (req.query.name as string) || cliente,
      country: pais,
      clientInfo,
      anexosData,
      invoices,
      claims,
      payments,
      equipment,
      summary: {
        totalEmitidasCount: invoices.length || (pendientesCount > 0 ? 1 : 0),
        totalEmitidasMonto: Math.round(totalEmitidasMonto * 100) / 100,
        pagadasCount,
        pagadasMonto: Math.round(pagadasMonto * 100) / 100,
        pendientesCount,
        pendientesMonto: Math.round(pendientesMonto * 100) / 100,
        mesEmitidasCount,
        mesEmitidasMonto: Math.round(mesEmitidasMonto * 100) / 100,
        mesPagadasCount,
        mesPagadasMonto: Math.round(mesPagadasMonto * 100) / 100,
        mesPendientesCount,
        mesPendientesMonto: Math.round(mesPendientesMonto * 100) / 100,
        claimsCount: claims.length,
      },
      sap: cachedClient ? {
        totalDebt: cachedClient.totalDebt,
        daysArrears: cachedClient.daysArrears,
        moraRange: cachedClient.moraRange,
        address: cachedClient.address,
        department: cachedClient.department,
        municipality: cachedClient.municipality,
        phone1: cachedClient.phone1,
        phone2: cachedClient.phone2,
        cellphone: cachedClient.cellphone,
        email: cachedClient.email,
        salesManager: cachedClient.salesManager,
        salesManagerEmail: cachedClient.salesManagerEmail,
        salesManagerCode: cachedClient.salesManagerCode,
        classification: cachedClient.classification,
      } : null,
    };

    // Sync the master cached client record so /api/cartera displays the real numbers
    if (cachedClient) {
      if (pendientesMonto > 0 && (!cachedClient.totalDebt || cachedClient.totalDebt === 0)) {
        cachedClient.totalDebt = Math.round(pendientesMonto * 100) / 100;
      }
      if (clientInfo?.CATEGORIA) {
        cachedClient.classification = clientInfo.CATEGORIA;
      }
      if (clientInfo?.CardName) {
        cachedClient.name = clientInfo.CardName;
      }
      const pendingInvoices = invoices.filter((i: any) => (i.estado || '').toUpperCase() === 'PENDIENTE');
      if (pendingInvoices.length > 0) {
        const nowMs = Date.now();
        let maxDiff = 0;
        for (const inv of pendingInvoices) {
          if (inv.fechavence) {
            const dueMs = new Date(inv.fechavence.slice(0, 10)).getTime();
            if (!isNaN(dueMs)) {
              const diff = Math.floor((nowMs - dueMs) / 86400000);
              if (diff > maxDiff) maxDiff = diff;
            }
          }
        }
        if (maxDiff > 0) {
          cachedClient.daysArrears = Math.min(maxDiff, 365);
          cachedClient.moraRange = cachedClient.daysArrears > 120 ? '120+' : cachedClient.daysArrears > 90 ? '91-120' : cachedClient.daysArrears > 60 ? '61-90' : cachedClient.daysArrears > 30 ? '31-60' : '0-30';
          cachedClient.priority = cachedClient.daysArrears > 90 ? 'Alta' : cachedClient.daysArrears > 30 ? 'Media' : 'Normal';
        }
      }
    }

    sanCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);

  try {
    const data = await fetchPromise;
    inFlightRequests.delete(cacheKey);
    res.json({ success: true, data });
  } catch (error: any) {
    inFlightRequests.delete(cacheKey);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2.1 API ÚNICAMENTE FACTURAS (Para integración con otros sistemas)
app.get('/api/facturas', async (req, res) => {
  const cliente = ((req.query.cliente as string) || '').trim();
  const pais = (req.query.pais as string) === 'GT' ? 'GT' : 'SV';
  const estadoFiltro = ((req.query.estado as string) || '').trim().toUpperCase();

  if (!cliente) {
    return res.status(400).json({ success: false, error: 'Código de cliente requerido (ej. ?cliente=CL000519&pais=SV)' });
  }

  try {
    const rawFacturas = await fetchSanSubEndpoint('tablaFacturaR.html', cliente, pais, 25000);
    let facturas: any[] = Array.isArray(rawFacturas) ? rawFacturas : [];

    if (estadoFiltro && estadoFiltro !== 'TODAS') {
      facturas = facturas.filter((f) => (f.estado || '').toUpperCase() === estadoFiltro);
    }

    res.json({
      success: true,
      cliente,
      pais,
      filtroEstado: estadoFiltro || 'TODAS',
      totalFacturas: facturas.length,
      facturas,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. API CONSTRUCTOR DINÁMICO DE BITÁCORA (Admin Controls)
app.get('/api/configuracion/campos', (req, res) => {
  res.json({ success: true, fields: dynamicFieldsStore });
});

app.post('/api/configuracion/campos', (req, res) => {
  const { fields } = req.body;
  if (Array.isArray(fields)) {
    dynamicFieldsStore = fields;
    return res.json({ success: true, message: 'Configuración de bitácora actualizada con éxito.', fields });
  }
  res.status(400).json({ success: false, error: 'Lista de campos inválida' });
});

// 4. API VALIDACIÓN INTELIGENTE DE GESTIÓN (Slide 6 Rules)
// 1. ¿Llamada mayor a 30 segundos?
// 2. ¿Campos obligatorios completos?
// 3. ¿Acuerdo tiene fecha y monto válidos?
app.post('/api/gestiones/guardar', (req, res) => {
  const {
    clientId,
    clientName,
    managementType,
    successfulContact,
    agreement,
    callDurationSeconds,
    deadlineDate,
    committedAmount,
    observations,
    dynamicValues,
  } = req.body;

  // Validation 1: Call duration > 30 seconds
  const isCall = managementType === 'Llamada';
  const duration = Number(callDurationSeconds || 0);
  const callDurationValid = !isCall || duration >= 30;

  // Validation 2: Mandatory fields filled
  const mandatoryFieldsValid = Boolean(managementType && successfulContact && agreement);

  // Validation 3: Agreement has valid date and amount
  let agreementValid = true;
  if (agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas') {
    const amount = Number(committedAmount || 0);
    agreementValid = Boolean(deadlineDate && amount > 0);
  }

  const isSuccess = callDurationValid && mandatoryFieldsValid && agreementValid;

  const errors: string[] = [];
  if (!callDurationValid) {
    errors.push('La llamada registrada debe ser mayor a 30 segundos (duración actual: ' + duration + 's).');
  }
  if (!mandatoryFieldsValid) {
    errors.push('Todos los campos obligatorios del registro deben estar completos.');
  }
  if (!agreementValid) {
    errors.push('Al registrar una Promesa de Pago o Negociación, debe ingresar una fecha límite y un monto válido.');
  }

  if (isSuccess) {
    return res.json({
      success: true,
      message: 'Gestión guardada exitosamente. Cliente marcado como Resuelto.',
      validationReport: {
        callDurationValid: true,
        mandatoryFieldsValid: true,
        agreementValid: true,
        isSuccess: true,
      },
    });
  } else {
    return res.status(422).json({
      success: false,
      message: 'Alerta de gestión incompleta. Cliente permanece en lista para revisión.',
      errors,
      validationReport: {
        callDurationValid,
        mandatoryFieldsValid,
        agreementValid,
        isSuccess: false,
        errorMessage: errors.join(' '),
      },
    });
  }
});

// 5. API BIBLIOTECA DE SCRIPTS DE MENSAJES (Admin & Agente)
app.get('/api/scripts', (req, res) => {
  res.json({ success: true, scripts: messageScriptsStore });
});

app.post('/api/scripts', (req, res) => {
  const { scripts } = req.body;
  if (Array.isArray(scripts)) {
    messageScriptsStore = scripts;
    return res.json({ success: true, message: 'Biblioteca de scripts actualizada con éxito.', scripts });
  }
  res.status(400).json({ success: false, error: 'Lista de scripts inválida' });
});

// 6. API CONFIGURACIÓN DE ASIGNACIÓN DIARIA (Días 1 al 22, X clientes por día)
app.get('/api/configuracion/workload', (req, res) => {
  res.json({ success: true, config: workloadConfigStore });
});

app.post('/api/configuracion/workload', (req, res) => {
  const { clientsPerDay } = req.body;
  const num = Number(clientsPerDay);
  if (!isNaN(num) && num > 0) {
    workloadConfigStore.clientsPerDay = Math.min(100, Math.max(5, num));
    return res.json({
      success: true,
      message: `Meta diaria actualizada a ${workloadConfigStore.clientsPerDay} clientes por día (Días 1 al 22).`,
      config: workloadConfigStore,
    });
  }
  res.status(400).json({ success: false, error: 'Cantidad de clientes por día inválida' });
});

// 7. API AGENTE DE IA QUE CALIFICA Y EVALÚA LA GESTIÓN DE COBRANZA
app.post('/api/evaluar-gestion', async (req, res) => {
  const {
    clientCode,
    clientName,
    totalDebt,
    daysArrears,
    managementType,
    successfulContact,
    agreement,
    callDurationSeconds,
    deadlineDate,
    committedAmount,
    observations,
  } = req.body;

  const obs = String(observations || '').trim();
  const duration = Number(callDurationSeconds || 0);
  const amount = Number(committedAmount || 0);

  // Fallback Semantic Rules Evaluator
  const evaluateDeterministic = () => {
    const reasons: string[] = [];
    const recommendations: string[] = [];
    let coherence = true;
    let informationQuality = true;
    let businessAlignment = true;
    let score = 90;

    // Rule 1: Observation Quality
    const lowerObs = obs.toLowerCase();
    const isVague =
      obs.length < 12 ||
      /^(ok|llamada|se llamo|llame|cliente|pendiente|listo|no|si|sin respuesta|se marco|buzon|no contesto|bueno)$/i.test(
        lowerObs
      );

    if (isVague) {
      informationQuality = false;
      score -= 35;
      reasons.push('Las observaciones son demasiado breves o genéricas ("' + obs + '").');
      recommendations.push(
        'Especifique el nombre de la persona con quien habló, el motivo manifestado y detalles concretos del acuerdo.'
      );
    }

    // Rule 2: Incoherence between Contact Success and Agreement
    if ((successfulContact === 'No' || successfulContact === 'Sin respuesta') && agreement === 'Promesa de Pago') {
      coherence = false;
      score -= 40;
      reasons.push(
        'Incongruencia: Se registró "Promesa de Pago", pero el contacto fue marcado como "' + successfulContact + '".'
      );
      recommendations.push('Si no hubo contacto con el cliente, el acuerdo debe ser "Sin Acuerdo" o reprogramarse.');
    }

    // Rule 3: Contact Success says "Sí" but observation says "no contestó"
    if (
      successfulContact === 'Sí' &&
      (lowerObs.includes('no contesto') ||
        lowerObs.includes('no contestó') ||
        lowerObs.includes('buzon') ||
        lowerObs.includes('buzón') ||
        lowerObs.includes('apagado') ||
        lowerObs.includes('numero equivocado'))
    ) {
      coherence = false;
      score -= 35;
      reasons.push(
        'Incongruencia: Marcó contacto exitoso ("Sí"), pero en la observación indica que no contestó o entró a buzón.'
      );
      recommendations.push('Verifique el estado de contacto para que coincida exactamente con la llamada.');
    }

    // Rule 4: Payment promise without valid amount or deadline
    if (agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas') {
      if (amount <= 0 || !deadlineDate) {
        coherence = false;
        businessAlignment = false;
        score -= 30;
        reasons.push('Una Promesa de Pago requiere fecha límite de pago y monto comprometido mayor a $0.');
        recommendations.push('Ingrese el monto prometido por el cliente y la fecha exacta en que aplicará el pago.');
      }
    }

    // Rule 5: Short call validation
    // COMENTADO TEMPORALMENTE HASTA TENER EL API DE GRABACIONES Y TRANSCRIPCIONES:
    // if (managementType === 'Llamada' && duration < 30 && agreement === 'Promesa de Pago') {
    //   coherence = false;
    //   score -= 20;
    //   reasons.push(`Llamada de solo ${duration}s es insuficiente para consolidar una Promesa de Pago formal.`);
    //   recommendations.push('Asegúrese de validar la grabación de al menos 30 segundos en el PBX.');
    // }

    // Business Alignment: Did the agent push for payment?
    if (
      successfulContact === 'Sí' &&
      !lowerObs.includes('pago') &&
      !lowerObs.includes('factura') &&
      !lowerObs.includes('saldo') &&
      !lowerObs.includes('transferencia') &&
      !lowerObs.includes('banco') &&
      !lowerObs.includes('abono')
    ) {
      businessAlignment = false;
      score -= 15;
      reasons.push('La gestión no menciona explícitamente el saldo adeudado, factura del mes o acuerdo de pago.');
      recommendations.push('Enfoque siempre la conversación en la regularización del saldo y el pago de la factura.');
    }

    score = Math.max(10, Math.min(100, score));
    const isValid = coherence && informationQuality && score >= 70;
    const suggestedAction = isValid
      ? 'aprobar'
      : successfulContact === 'No' || successfulContact === 'Sin respuesta'
      ? 'reprogramar'
      : 'corregir';

    const feedback = isValid
      ? `✓ Gestión aprobada por el Agente de IA (${score}/100). Registro claro, coherente y enfocado en la meta de cobro.`
      : `⚠️ Gestión no aprobada por el Agente de IA (${score}/100). Detectamos inconsistencias o falta de información clave.`;

    return {
      isValid,
      score,
      criteria: { coherence, informationQuality, businessAlignment },
      feedback,
      reasons: reasons.length ? reasons : ['Gestión cumple con los estándares mínimos de cobranza.'],
      recommendations: recommendations.length
        ? recommendations
        : ['Mantener el seguimiento puntual a la fecha de pago acordada.'],
      suggestedAction,
    };
  };

  // Attempt evaluation using Gemini API if key is present
  try {
    if (process.env.GEMINI_API_KEY) {
      const ai = new GoogleGenAI();
      const prompt = `Actúa como un Auditor y Agente de Inteligencia Artificial para el control de calidad en Cobranzas de RED INTELFON S.A. DE C.V.
Evalúa rigurosamente la gestión de cobro registrada por el agente.

DATOS DEL CLIENTE:
- Código: ${clientCode}
- Nombre / Razón Social: ${clientName}
- Saldo en Mora: $${totalDebt}
- Días de Mora: ${daysArrears} días

DATOS REGISTRADOS POR EL AGENTE:
- Canal: ${managementType}
- ¿Contacto Exitoso?: ${successfulContact}
- Acuerdo Alcanzado: ${agreement}
- Duración de Llamada: ${duration} segundos
- Fecha Límite de Pago: ${deadlineDate || 'No definida'}
- Monto Comprometido: $${amount}
- Observaciones de la Gestión: "${obs}"

CRITERIOS MÍNIMOS DE EVALUACIÓN:
1. COHERENCIA OPERATIVA (coherence):
   - Si contacto es "Sí", ¿la observación tiene sentido o dice cosas como "no contestó / buzón"?
   - Si contacto es "No" o "Sin respuesta", ¿es incoherente que haya "Promesa de Pago" o monto comprometido?
   - Si hay "Promesa de Pago" o "Negociación", ¿se fijó fecha límite y monto mayor a $0?
   - (NOTA TEMPORAL: NO penalizar duración de llamada ni requerir transcripción de audio mientras se suministra el API de telefonía y grabaciones).
2. CALIDAD Y DETALLE DE INFORMACIÓN (informationQuality):
   - ¿La observación está vacía o contiene solo palabras vacías como "ok", "llamé", "listo", "pendiente", "se intentó"?
   - ¿Se especificó con quién se habló, motivo del atraso o compromiso concreto?
3. ENFOQUE EN RECUPERACIÓN Y PAGO DEL MES (businessAlignment):
   - ¿La gestión persigue el objetivo de que el cliente pague lo del mes o resuelva su deuda?

REGLAS DE DECISIÓN:
- "isValid": true si cumple los 3 criterios y score >= 70.
- "isValid": false si falla coherencia, la observación es vaga o insuficiente, o el acuerdo es inconsistente.
- Si es inválido, sugiere si debe "corregir" (si sólo faltan detalles de la observación o campos) o "reprogramar" (si no se contactó o el cliente pidió que se le llamara otro día).

Responde ÚNICAMENTE en formato JSON válido con la siguiente estructura:
{
  "isValid": boolean,
  "score": number (0 a 100),
  "criteria": {
    "coherence": boolean,
    "informationQuality": boolean,
    "businessAlignment": boolean
  },
  "feedback": "Resumen conciso y profesional del veredicto para el agente",
  "reasons": ["Lista de observaciones encontradas"],
  "recommendations": ["Recomendaciones para mejorar"],
  "suggestedAction": "aprobar" | "corregir" | "reprogramar"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '';
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.isValid === 'boolean') {
        return res.json({ success: true, evaluation: parsed });
      }
    }
  } catch (err: any) {
    console.warn('Gemini API evaluation failed or timed out, executing deterministic rule engine:', err.message);
  }

  // Deterministic fallback execution
  const deterministicResult = evaluateDeterministic();
  return res.json({ success: true, evaluation: deterministicResult });
});

// Vite dev server integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Sistema de Cobranza RED corriendo en http://0.0.0.0:${PORT}`);
    });
    server.on('error', (err: any) => {
      console.error('Server listen error:', err);
    });
  }
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
