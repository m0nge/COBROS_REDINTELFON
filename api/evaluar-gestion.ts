type Evaluation = {
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
  suggestedAction: 'aprobar' | 'corregir' | 'reprogramar';
};

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function evaluateManagement(body: any): Evaluation {
  const successfulContact = String(body.successfulContact || '');
  const agreement = String(body.agreement || '');
  const contactName = String(body.contactName || '').trim();
  const contactNameLetters = contactName.replace(/[^a-záéíóúüñ]/gi, '').length;
  const contactPhone = String(body.contactPhone || '').trim();
  const phoneDigits = contactPhone.replace(/\D/g, '');
  const deadlineDate = String(body.deadlineDate || '');
  const amount = Number(body.committedAmount || 0);
  const details = String(body.agreementDetails || '').trim();
  const observations = String(body.observations || '').trim();
  const narrative = `${details}\n${observations}`.trim();
  const isPromise = agreement === 'Promesa de Pago' || agreement === 'Negociación de Cuotas';
  const hasPromiseFields = contactNameLetters > 5
    && phoneDigits.length >= 8
    && /^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)
    && Number.isFinite(amount)
    && amount > 0;
  const contradictsContact = successfulContact === 'Sí'
    && /\b(no contest[oó]|sin respuesta|buz[oó]n|n[uú]mero equivocado|apagado)\b/i.test(narrative);

  const reasons: string[] = [];
  const recommendations: string[] = [];
  const coherence = !contradictsContact && (!isPromise || hasPromiseFields);
  const informationQuality = !isPromise || hasPromiseFields;
  const businessAlignment = Boolean(agreement) && (!isPromise || (Boolean(deadlineDate) && amount > 0));

  if (contradictsContact) {
    reasons.push('El texto indica que no hubo respuesta, pero el contacto está marcado como exitoso.');
    recommendations.push('Ajusta la respuesta de contacto o corrige el detalle de la gestión.');
  }
  if (isPromise && contactNameLetters <= 5) reasons.push('El nombre de contacto debe tener más de 5 letras.');
  if (isPromise && phoneDigits.length < 8) reasons.push('El teléfono debe tener al menos 8 dígitos.');
  if (isPromise && !/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) reasons.push('Selecciona una fecha de promesa válida.');
  if (isPromise && (!Number.isFinite(amount) || amount <= 0)) reasons.push('Ingresa un monto prometido mayor a cero.');
  if (reasons.length && recommendations.length === 0) {
    recommendations.push('Completa los datos obligatorios de la promesa y vuelve a guardar.');
  }

  const validCriteria = [coherence, informationQuality, businessAlignment].filter(Boolean).length;
  const score = Math.round((validCriteria / 3) * 100);
  const isValid = validCriteria === 3;

  return {
    isValid,
    score,
    criteria: { coherence, informationQuality, businessAlignment },
    feedback: isValid
      ? 'Los datos de contacto, acuerdo y promesa son coherentes.'
      : 'La gestión todavía tiene datos obligatorios o inconsistencias por corregir.',
    reasons: reasons.length ? reasons : ['Los campos estructurados cumplen las reglas de validación.'],
    recommendations: recommendations.length ? recommendations : ['Puedes guardar la gestión.'],
    suggestedAction: isValid ? 'aprobar' : 'corregir',
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '');
  const clientIp = forwardedFor.split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const requestWindow = requestCounts.get(clientIp);
  if (requestWindow && requestWindow.resetAt > now && requestWindow.count >= 30) {
    return res.status(429).json({ success: false, error: 'Demasiadas evaluaciones. Intenta de nuevo en un minuto.' });
  }
  requestCounts.set(
    clientIp,
    requestWindow && requestWindow.resetAt > now
      ? { count: requestWindow.count + 1, resetAt: requestWindow.resetAt }
      : { count: 1, resetAt: now + 60_000 }
  );

  const body = req.body || {};
  if (String(body.successfulContact || '') !== 'Sí') {
    return res.status(400).json({
      success: false,
      error: 'Esta evaluación solo aplica cuando hubo contacto exitoso.',
    });
  }

  return res.status(200).json({ success: true, evaluation: evaluateManagement(body) });
}
