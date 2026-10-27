import * as XLSX from 'xlsx';
import { Client, Country, PortfolioUploadResult } from '../types';

/**
 * Normalizes header string for robust column mapping
 */
function normalizeHeader(str: string): string {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a string contains typical inactive indicators
 */
export function isStatusInactive(val: any): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).trim().toUpperCase();
  if (!s) return false;
  return (
    s.includes('INACT') ||
    s.includes('BAJA') ||
    s.includes('CANCEL') ||
    s.includes('SUSPEND') ||
    s.includes('NO ACTIVO') ||
    s.includes('DESACTIVADO') ||
    s === 'INACTIVO' ||
    s === 'INACTIVA' ||
    s === 'NO' ||
    s === '0' ||
    s === 'FALSE'
  );
}

/**
 * Detects which columns correspond to:
 * 1. Codigo de Cliente
 * 2. Nombre del Cliente
 * 3. Estatus (opcional)
 */
function detectColumns(headers: string[]): {
  codeCol: string | null;
  nameCol: string | null;
  statusCol: string | null;
} {
  let codeCol: string | null = null;
  let nameCol: string | null = null;
  let statusCol: string | null = null;

  const codeCandidates = [
    'coddecliente',
    'codigodecliente',
    'codigocliente',
    'codcliente',
    'codigo',
    'cod',
    'cardcode',
    'codigocartera',
    'idcliente',
    'nocuenta',
    'cuenta',
    'cliente',
  ];

  const nameCandidates = [
    'nombredelcliente',
    'nombrecliente',
    'nombre',
    'razonsocial',
    'cardname',
    'descripcion',
    'titular',
    'empresa',
    'clienteempresa',
  ];

  const statusCandidates = [
    'estatus',
    'status',
    'estado',
    'condicion',
    'situacion',
    'activo',
  ];

  for (const h of headers) {
    const norm = normalizeHeader(h);

    if (!codeCol && codeCandidates.some((c) => norm === c || norm.startsWith('cod'))) {
      codeCol = h;
      continue;
    }

    if (!nameCol && nameCandidates.some((c) => norm === c || norm.includes('nombre') || norm.includes('razon'))) {
      nameCol = h;
      continue;
    }

    if (!statusCol && statusCandidates.some((c) => norm === c || norm.includes('estat') || norm.includes('status'))) {
      statusCol = h;
      continue;
    }
  }

  // Fallback for code if not found: any header containing 'cod'
  if (!codeCol) {
    codeCol = headers.find((h) => normalizeHeader(h).includes('cod')) || null;
  }

  // Fallback for name if not found: any header containing 'nom' or 'client'
  if (!nameCol) {
    nameCol = headers.find((h) => {
      const norm = normalizeHeader(h);
      return (norm.includes('nom') || norm.includes('client')) && h !== codeCol;
    }) || null;
  }

  // If still not found and we have at least 2 headers, use column 0 and column 1
  if (!codeCol && headers.length > 0) codeCol = headers[0];
  if (!nameCol && headers.length > 1) nameCol = headers[1];

  return { codeCol, nameCol, statusCol };
}

/**
 * Extracts text from a PDF file using pdfjs-dist
 */
async function extractTextFromPDF(file: File): Promise<string[]> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    // Configure worker
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const lines: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Group items by vertical position (y coordinate) to reconstruct table rows
      const itemsByY = new Map<number, string[]>();
      for (const item of textContent.items as any[]) {
        const text = (item.str || '').trim();
        if (!text) continue;
        const y = Math.round(item.transform[5] / 4) * 4; // round to nearest line band
        if (!itemsByY.has(y)) itemsByY.set(y, []);
        itemsByY.get(y)!.push(text);
      }

      // Sort descending by Y coordinate (PDF coordinates top to bottom)
      const sortedYs = Array.from(itemsByY.keys()).sort((a, b) => b - a);
      for (const y of sortedYs) {
        const rowText = itemsByY.get(y)!.join(' | ');
        if (rowText.trim()) lines.push(rowText);
      }
    }

    return lines;
  } catch (pdfErr) {
    console.warn('PDF.js standard parse failed, trying text decoder fallback:', pdfErr);
    // Raw text fallback for basic text-embedded PDFs
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const regex = /CL\d{4,8}[^\n\r]+/g;
    const matches = text.match(regex);
    return matches || [];
  }
}

/**
 * Parses a raw line or row and returns client code, name, and status
 */
interface ParsedRow {
  code: string;
  name: string;
  isInactive: boolean;
}

/**
 * Main parser: handles Excel (.xlsx, .xls), CSV (.csv), and PDF (.pdf)
 */
export async function parsePortfolioFile(
  file: File,
  country: Country,
  existingSapClients: Client[]
): Promise<PortfolioUploadResult> {
  const fileName = file.name;
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

  let parsedRows: ParsedRow[] = [];
  let fileType: 'excel' | 'pdf' | 'csv' | 'text' = 'excel';

  if (ext === '.pdf') {
    fileType = 'pdf';
    const lines = await extractTextFromPDF(file);

    for (const line of lines) {
      // Look for SAP code pattern CL followed by numbers, e.g. CL000519 or CL12345
      const codeMatch = line.match(/\b(CL\d{4,8})\b/i);
      if (codeMatch) {
        const code = codeMatch[1].toUpperCase();
        // Remove code and separators to get client name
        let rest = line
          .replace(codeMatch[0], '')
          .replace(/^[|,\t\s-]+|[|,\t\s-]+$/g, '')
          .trim();

        // Check if line indicates inactive
        const isInactive = isStatusInactive(line);

        // Clean up common status words from name
        rest = rest.replace(/\b(ACTIVO|INACTIVO|ACTIVA|INACTIVA|AL DIA|NORMAL|PENDIENTE|RESUELTO)\b/gi, '').trim();
        // If pipe separated, take the most descriptive text fragment
        if (rest.includes('|')) {
          const parts = rest.split('|').map((p) => p.trim()).filter((p) => p.length > 2 && !/^\d+([.,]\d+)?$/.test(p));
          rest = parts[0] || rest;
        }

        parsedRows.push({
          code,
          name: rest || `CLIENTE ${code}`,
          isInactive,
        });
      }
    }
  } else {
    // Excel or CSV file
    fileType = ext === '.csv' ? 'csv' : 'excel';
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

    if (rawRows.length > 0) {
      const headers = Object.keys(rawRows[0]);
      const { codeCol, nameCol, statusCol } = detectColumns(headers);

      for (const row of rawRows) {
        let rawCode = codeCol ? String(row[codeCol] || '').trim() : '';
        let rawName = nameCol ? String(row[nameCol] || '').trim() : '';
        let rawStatus = statusCol ? String(row[statusCol] || '').trim() : '';

        // If no code found in target column, search row values for CLxxxxxx
        if (!rawCode || !rawCode.toUpperCase().startsWith('CL')) {
          for (const val of Object.values(row)) {
            const strVal = String(val).trim().toUpperCase();
            if (/^CL\d{4,8}$/.test(strVal)) {
              rawCode = strVal;
              break;
            }
          }
        }

        if (!rawCode) continue;

        // Ensure proper code format
        const cleanCode = rawCode.toUpperCase();

        // Check status in row
        let isInactive = isStatusInactive(rawStatus);
        if (!isInactive) {
          // Check all row values to see if any cell says INACTIVO
          for (const val of Object.values(row)) {
            if (isStatusInactive(val)) {
              isInactive = true;
              break;
            }
          }
        }

        parsedRows.push({
          code: cleanCode,
          name: rawName || `CLIENTE ${cleanCode}`,
          isInactive,
        });
      }
    }
  }

  // Filter out inactive clients as strictly requested by user:
  // "los cliente inactivos no los ncluyas eso esta en estatus, solo los activos deben salir en este sistema"
  const totalRowsFound = parsedRows.length;
  const activeRows = parsedRows.filter((r) => !r.isInactive);
  const inactiveRowsOmitted = totalRowsFound - activeRows.length;

  // Build a lookup map of existing SAP clients (by code and normalized name)
  const sapByCode = new Map<string, Client>();
  const sapByName = new Map<string, Client>();

  for (const c of existingSapClients) {
    if (c.code) sapByCode.set(c.code.toUpperCase(), c);
    if (c.name) sapByName.set(c.name.trim().toLowerCase(), c);
  }

  const assignedClients: Client[] = [];
  const unmatchedCodes: string[] = [];
  let matchedInSapCount = 0;
  let newClientsCount = 0;
  let totalDebtCalculated = 0;

  // Deduplicate active codes
  const seenCodes = new Set<string>();

  for (const row of activeRows) {
    if (seenCodes.has(row.code)) continue;
    seenCodes.add(row.code);

    let matchedClient = sapByCode.get(row.code);

    // If not matched by exact code, try fuzzy name match
    if (!matchedClient && row.name) {
      const normName = row.name.trim().toLowerCase();
      matchedClient = sapByName.get(normName);
      if (!matchedClient) {
        matchedClient = existingSapClients.find((c) =>
          c.name.toLowerCase().includes(normName) || normName.includes(c.name.toLowerCase())
        );
      }
    }

    if (matchedClient) {
      matchedInSapCount++;
      const debt = matchedClient.totalDebt || 0;
      totalDebtCalculated += debt;

      assignedClients.push({
        ...matchedClient,
        // Override name if the uploaded file has a cleaner version
        name: row.name && row.name !== `CLIENTE ${row.code}` ? row.name : matchedClient.name,
        status: 'ACTIVO',
        estatus: 'ACTIVO',
        isManualAssignment: true,
      });
    } else {
      newClientsCount++;
      unmatchedCodes.push(row.code);
      // Construct a new active client record compatible with the system
      const newClient: Client = {
        code: row.code,
        name: row.name || `CLIENTE ${row.code}`,
        country,
        status: 'ACTIVO',
        estatus: 'ACTIVO',
        totalDebt: 0,
        daysArrears: 0,
        moraRange: '0-30',
        state: 'Pendiente',
        priority: 'Normal',
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate: new Date().toISOString().split('T')[0],
        classification: 'PERSONA JURIDICA',
        salesManager: country === 'SV' ? 'Carlos Santos' : 'Jonathan Jiménez',
        managerEmail: country === 'SV' ? 'csantos@red.com.sv' : 'jjimenez@red.com.gt',
        isManualAssignment: true,
      };
      assignedClients.push(newClient);
    }
  }

  return {
    fileName,
    fileType,
    totalRowsFound,
    activeRowsParsed: activeRows.length,
    inactiveRowsOmitted,
    matchedInSapCount,
    newClientsCount,
    totalDebtCalculated: Math.round(totalDebtCalculated * 100) / 100,
    clients: assignedClients,
    unmatchedCodes,
  };
}

/**
 * Parses pasted text (e.g. from clipboard or manual input)
 */
export function parsePastedText(
  text: string,
  country: Country,
  existingSapClients: Client[]
): PortfolioUploadResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parsedRows: ParsedRow[] = [];

  for (const line of lines) {
    const codeMatch = line.match(/\b(CL\d{4,8})\b/i);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      let rest = line
        .replace(codeMatch[0], '')
        .replace(/^[|,\t\s-]+|[|,\t\s-]+$/g, '')
        .trim();

      const isInactive = isStatusInactive(line);
      rest = rest.replace(/\b(ACTIVO|INACTIVO|ACTIVA|INACTIVA|AL DIA|NORMAL|PENDIENTE|RESUELTO)\b/gi, '').trim();

      parsedRows.push({
        code,
        name: rest || `CLIENTE ${code}`,
        isInactive,
      });
    }
  }

  const totalRowsFound = parsedRows.length;
  const activeRows = parsedRows.filter((r) => !r.isInactive);
  const inactiveRowsOmitted = totalRowsFound - activeRows.length;

  const sapByCode = new Map<string, Client>();
  for (const c of existingSapClients) {
    if (c.code) sapByCode.set(c.code.toUpperCase(), c);
  }

  const assignedClients: Client[] = [];
  const unmatchedCodes: string[] = [];
  let matchedInSapCount = 0;
  let newClientsCount = 0;
  let totalDebtCalculated = 0;

  const seenCodes = new Set<string>();
  for (const row of activeRows) {
    if (seenCodes.has(row.code)) continue;
    seenCodes.add(row.code);

    const matched = sapByCode.get(row.code);
    if (matched) {
      matchedInSapCount++;
      totalDebtCalculated += matched.totalDebt || 0;
      assignedClients.push({
        ...matched,
        name: row.name && row.name !== `CLIENTE ${row.code}` ? row.name : matched.name,
        status: 'ACTIVO',
        estatus: 'ACTIVO',
        isManualAssignment: true,
      });
    } else {
      newClientsCount++;
      unmatchedCodes.push(row.code);
      assignedClients.push({
        code: row.code,
        name: row.name || `CLIENTE ${row.code}`,
        country,
        status: 'ACTIVO',
        estatus: 'ACTIVO',
        totalDebt: 0,
        daysArrears: 0,
        moraRange: '0-30',
        state: 'Pendiente',
        priority: 'Normal',
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate: new Date().toISOString().split('T')[0],
        classification: 'PERSONA JURIDICA',
        salesManager: country === 'SV' ? 'Carlos Santos' : 'Jonathan Jiménez',
        managerEmail: country === 'SV' ? 'csantos@red.com.sv' : 'jjimenez@red.com.gt',
        isManualAssignment: true,
      });
    }
  }

  return {
    fileName: 'Texto pegado manualmente',
    fileType: 'text',
    totalRowsFound,
    activeRowsParsed: activeRows.length,
    inactiveRowsOmitted,
    matchedInSapCount,
    newClientsCount,
    totalDebtCalculated: Math.round(totalDebtCalculated * 100) / 100,
    clients: assignedClients,
    unmatchedCodes,
  };
}
