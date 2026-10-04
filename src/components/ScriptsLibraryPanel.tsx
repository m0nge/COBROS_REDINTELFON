import React, { useState, useRef } from 'react';
import { MessageScript, Client } from '../types';
import {
  MessageSquareText,
  Plus,
  Copy,
  Check,
  Edit2,
  Trash2,
  Sparkles,
  Save,
  Send,
  HelpCircle,
  FileCode,
  Tag,
  Eye,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface ScriptsLibraryPanelProps {
  scripts: MessageScript[];
  onSaveScripts: (updatedScripts: MessageScript[]) => void;
  sampleClient?: Client;
  isAdmin?: boolean;
}

const AVAILABLE_VARIABLES = [
  { tag: '{nombre_cliente}', label: 'Nombre Cliente', desc: 'Razón social registrada en SAP ERP', example: 'FIJAPRES, S.A. DE C.V' },
  { tag: '{codigo_cliente}', label: 'Código Cliente', desc: 'Identificador único en SAP', example: 'CL000519' },
  { tag: '{contacto}', label: 'Contacto / Encargado', desc: 'Nombre de la persona o contacto de cobros', example: 'Encargado(a) de Pagos' },
  { tag: '{monto_total}', label: 'Monto Total Deuda', desc: 'Saldo total pendiente de cobro', example: '$105.09' },
  { tag: '{monto_mes}', label: 'Monto Factura del Mes', desc: 'Valor del corte o factura del mes actual', example: '$62.14' },
  { tag: '{dias_mora}', label: 'Días de Mora', desc: 'Antigüedad máxima de la mora', example: '39 días' },
  { tag: '{facturas_pendientes_count}', label: 'N° Facturas Pendientes', desc: 'Cantidad de DTEs pendientes', example: '2' },
  { tag: '{fecha_corte}', label: 'Fecha de Corte / Vence', desc: 'Fecha límite de pago de la factura', example: '31/10/2026' },
  { tag: '{gestor_comercial}', label: 'Gestor Comercial', desc: 'Ejecutivo de ventas asignado', example: 'Carlos Santos' },
  { tag: '{telefono_pbx}', label: 'PBX de Cobranzas', desc: 'Número PBX oficial de RED INTELFON', example: '(503) 2505-1000' },
  { tag: '{empresa_nombre}', label: 'Nombre de la Empresa', desc: 'Razón corporativa oficial', example: 'RED INTELFON S.A. DE C.V.' },
];

export const replaceScriptVariables = (templateText: string, client?: Partial<Client>): string => {
  if (!client) return templateText;

  const currency = client.country === 'GT' ? 'Q' : '$';
  const total = Number(client.totalDebt || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const mes = Number((client as any)?.pendingCount ? (client.totalDebt || 62.14) : 62.14).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const replacements: Record<string, string> = {
    '{nombre_cliente}': client.name || 'CLIENTE CORPORATIVO',
    '{codigo_cliente}': client.code || 'CL000000',
    '{contacto}': client.contactPerson || 'Encargado(a) de Cuentas por Pagar',
    '{monto_total}': `${currency}${total}`,
    '{monto_mes}': `${currency}${mes}`,
    '{dias_mora}': `${client.daysArrears || 0} días`,
    '{facturas_pendientes_count}': String((client as any)?.pendingCount || 1),
    '{fecha_corte}': client.dueDate || '31/10/2026',
    '{gestor_comercial}': client.salesManager || 'Carlos Santos',
    '{telefono_pbx}': client.country === 'GT' ? '(502) 2285-8000' : '(503) 2505-1000',
    '{empresa_nombre}': 'RED INTELFON S.A. DE C.V.',
  };

  let rendered = templateText;
  for (const [key, val] of Object.entries(replacements)) {
    rendered = rendered.split(key).join(val);
  }
  return rendered;
};

export const ScriptsLibraryPanel: React.FC<ScriptsLibraryPanelProps> = ({
  scripts,
  onSaveScripts,
  sampleClient,
  isAdmin = true,
}) => {
  const [selectedScriptId, setSelectedScriptId] = useState<string>(scripts[0]?.id || '');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Draft state for editor
  const [draftTitle, setDraftTitle] = useState('');
  const [draftChannel, setDraftChannel] = useState<MessageScript['channel']>('WhatsApp');
  const [draftAudience, setDraftAudience] = useState<MessageScript['targetAudience']>('Todos');
  const [draftTemplate, setDraftTemplate] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('TODOS');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedScript = scripts.find((s) => s.id === selectedScriptId) || scripts[0];

  const handleStartCreate = () => {
    setIsEditing(true);
    setSelectedScriptId('new');
    setDraftTitle('');
    setDraftChannel('WhatsApp');
    setDraftAudience('Todos');
    setDraftTemplate(
      `Estimado/a {contacto}, le saludamos de {empresa_nombre}.\n\nNos comunicamos respecto a su cuenta "{nombre_cliente}" ({codigo_cliente}). Le recordamos que presenta un saldo pendiente de {monto_total} correspondiente a sus servicios de telecomunicaciones.\n\nAgradeceremos su confirmación para la aplicación de su pago.\n\nAtentamente,\n{gestor_comercial} | PBX: {telefono_pbx}`
    );
  };

  const handleStartEdit = (script: MessageScript) => {
    setIsEditing(true);
    setSelectedScriptId(script.id);
    setDraftTitle(script.title);
    setDraftChannel(script.channel);
    setDraftAudience(script.targetAudience);
    setDraftTemplate(script.templateText);
  };

  const handleSaveDraft = () => {
    if (!draftTitle.trim() || !draftTemplate.trim()) return;

    if (selectedScriptId === 'new') {
      const newScript: MessageScript = {
        id: `script-${Date.now()}`,
        title: draftTitle.trim(),
        channel: draftChannel,
        targetAudience: draftAudience,
        templateText: draftTemplate.trim(),
        createdAt: new Date().toISOString().split('T')[0],
      };
      const updated = [...scripts, newScript];
      onSaveScripts(updated);
      setSelectedScriptId(newScript.id);
    } else {
      const updated = scripts.map((s) =>
        s.id === selectedScriptId
          ? {
              ...s,
              title: draftTitle.trim(),
              channel: draftChannel,
              targetAudience: draftAudience,
              templateText: draftTemplate.trim(),
              updatedAt: new Date().toISOString().split('T')[0],
            }
          : s
      );
      onSaveScripts(updated);
    }
    setIsEditing(false);
  };

  const handleDeleteScript = (scriptId: string) => {
    if (scripts.length <= 1) return;
    const updated = scripts.filter((s) => s.id !== scriptId);
    onSaveScripts(updated);
    setSelectedScriptId(updated[0]?.id || '');
    if (selectedScriptId === scriptId) {
      setIsEditing(false);
    }
  };

  const handleDuplicateScript = (script: MessageScript) => {
    const duplicate: MessageScript = {
      ...script,
      id: `script-${Date.now()}`,
      title: `${script.title} (Copia)`,
      createdAt: new Date().toISOString().split('T')[0],
      isDefault: false,
    };
    const updated = [...scripts, duplicate];
    onSaveScripts(updated);
    setSelectedScriptId(duplicate.id);
  };

  // Insert variable into textarea at current cursor position
  const insertVariable = (tag: string) => {
    if (!isEditing) return;
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraftTemplate((prev) => prev + ' ' + tag);
      return;
    }
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const text = draftTemplate;
    const updated = text.substring(0, start) + tag + text.substring(end);
    setDraftTemplate(updated);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  const handleCopyScript = (script: MessageScript) => {
    const rendered = replaceScriptVariables(script.templateText, sampleClient);
    navigator.clipboard?.writeText(rendered);
    setCopiedId(script.id);
    setTimeout(() => setCopiedId(null), 3000);
  };

  const filteredScripts = scripts.filter((s) => {
    if (channelFilter !== 'TODOS' && s.channel !== channelFilter) return false;
    return true;
  });

  const previewClient: Client = sampleClient || {
    code: 'CL000519',
    name: 'FIJAPRES, S.A. DE C.V',
    contactPerson: 'Lic. Roberto Morales (Cuentas por Pagar)',
    country: 'SV',
    totalDebt: 105.09,
    daysArrears: 0,
    moraRange: '0-30',
    state: 'Pendiente',
    priority: 'Normal',
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-31',
    salesManager: 'Esau Vides',
  };

  return (
    <div id="scripts-mensajes" className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <MessageSquareText className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <span>Biblioteca de Scripts de Mensajes</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-900/60 text-blue-300 font-mono border border-blue-700/50">
                  {scripts.length} plantillas
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Crea, personaliza y administra los guiones oficiales de cobranza con variables dinámicas que se reemplazan en tiempo real.
              </p>
            </div>
          </div>
        </div>

        {isAdmin && !isEditing && (
          <button
            type="button"
            onClick={handleStartCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 transition-all cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Crear Nuevo Script</span>
          </button>
        )}
      </div>

      {/* Main Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: LIST OF SCRIPTS (4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Plantillas Oficiales</span>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="text-[11px] px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium"
            >
              <option value="TODOS">Todos los Canales</option>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Email">Email</option>
              <option value="SMS">SMS</option>
            </select>
          </div>

          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1 custom-scrollbar">
            {filteredScripts.map((script) => {
              const isSelected = !isEditing && selectedScript?.id === script.id;
              return (
                <div
                  key={script.id}
                  onClick={() => {
                    if (!isEditing) setSelectedScriptId(script.id);
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-950/40 border-blue-500 shadow-md shadow-blue-500/10'
                      : 'bg-slate-900/70 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-bold font-mono ${
                            script.channel === 'WhatsApp'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                              : script.channel === 'Email'
                              ? 'bg-blue-950/80 text-blue-300 border border-blue-800/60'
                              : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                          }`}
                        >
                          {script.channel}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{script.targetAudience}</span>
                      </div>
                      <div className="text-xs font-bold text-white mt-1.5 line-clamp-1">{script.title}</div>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {script.templateText}
                      </p>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(script);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-blue-300 hover:bg-slate-800"
                          title="Editar script"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateScript(script);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-purple-300 hover:bg-slate-800"
                          title="Duplicar script"
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                        {scripts.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteScript(script.id);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800"
                            title="Eliminar script"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: SCRIPT DETAIL / INTERACTIVE EDITOR (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {isEditing ? (
            /* ======================================================= */
            /* SCRIPT EDITOR FORM WITH DRAGGABLE/CLICKABLE VARIABLES   */
            /* ======================================================= */
            <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 shadow-xl animate-fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-blue-400" />
                    <span>{selectedScriptId === 'new' ? 'Crear Nuevo Script de Cobranza' : 'Editar Script'}</span>
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Inserta las variables de clientes haciendo clic o arrastrándolas al texto.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar Script</span>
                  </button>
                </div>
              </div>

              {/* Title & Channel */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Título del Script</label>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Ej: Script de Recordatorio Preventivo"
                    className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Canal Sugerido</label>
                  <select
                    value={draftChannel}
                    onChange={(e) => setDraftChannel(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Email">Email / Correo</option>
                    <option value="SMS">SMS Mensaje</option>
                    <option value="General">General / Libre</option>
                  </select>
                </div>
              </div>

              {/* Audience */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Audiencia Objetivo (Rango de Mora)</label>
                <select
                  value={draftAudience}
                  onChange={(e) => setDraftAudience(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-xl glass-input font-medium"
                >
                  <option value="Todos">Todos los Clientes</option>
                  <option value="0-30 días (Preventivo)">0-30 días (Preventivo / Factura del Mes)</option>
                  <option value="31-60 días (Mora Leve)">31-60 días (Primer Contacto)</option>
                  <option value="61-90 días (Mora Moderada)">61-90 días (Segundo Contacto)</option>
                  <option value="91-120 días (Crítico)">91-120 días (Urgencia de Suspensión)</option>
                  <option value="120+ días (Cobranza Judicial)">120+ días (Escalación Judicial)</option>
                </select>
              </div>

              {/* CAJA DE VARIABLES ARRASTRABLES Y CLICKEABLES */}
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Caja de Variables Dinámicas (Haz clic o arrastra al texto)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">Se reemplazan automáticamente por cada cliente</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_VARIABLES.map((v) => (
                    <button
                      key={v.tag}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', v.tag);
                      }}
                      onClick={() => insertVariable(v.tag)}
                      title={`${v.desc} (Ejemplo: ${v.example})`}
                      className="px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-blue-950/70 hover:bg-blue-900 border border-blue-800/60 text-blue-200 transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-sm"
                    >
                      {v.tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Textarea */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Cuerpo del Script / Mensaje</label>
                <textarea
                  ref={textareaRef}
                  rows={8}
                  value={draftTemplate}
                  onChange={(e) => setDraftTemplate(e.target.value)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const text = e.dataTransfer.getData('text/plain');
                    if (text) insertVariable(text);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  placeholder="Redacta el mensaje aquí e inserta las variables necesarias..."
                  className="w-full p-3.5 text-xs rounded-xl bg-slate-950 border border-slate-700 text-slate-200 font-sans leading-relaxed focus:border-blue-500 focus:outline-none resize-y"
                />
              </div>

              {/* Live Preview Inside Editor */}
              <div className="p-3.5 rounded-xl bg-slate-950/90 border border-emerald-900/40 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5" />
                    Vista Previa en Vivo (Cliente Muestra: {previewClient.name})
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">{previewClient.code}</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-200 whitespace-pre-line leading-relaxed font-sans">
                  {replaceScriptVariables(draftTemplate, previewClient)}
                </div>
              </div>
            </div>
          ) : (
            /* ======================================================= */
            /* SCRIPT PREVIEW & ACTION CARD                           */
            /* ======================================================= */
            selectedScript && (
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-md font-bold font-mono ${
                          selectedScript.channel === 'WhatsApp'
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            : selectedScript.channel === 'Email'
                            ? 'bg-blue-950/80 text-blue-300 border border-blue-800/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        }`}
                      >
                        {selectedScript.channel}
                      </span>
                      <h3 className="text-base font-bold text-white">{selectedScript.title}</h3>
                    </div>
                    <span className="text-xs text-slate-400 mt-0.5 block">
                      Audiencia: <strong className="text-slate-200">{selectedScript.targetAudience}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyScript(selectedScript)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                    >
                      {copiedId === selectedScript.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-blue-400" />}
                      <span>{copiedId === selectedScript.id ? '¡Copiado con Datos!' : 'Copiar Texto Relleno'}</span>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(selectedScript)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Editar Plantilla</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Raw Template View */}
                <div>
                  <div className="text-[11px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Plantilla con Variables:
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono text-blue-300/90 whitespace-pre-line leading-relaxed">
                    {selectedScript.templateText}
                  </div>
                </div>

                {/* Live Output View */}
                <div>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400 mb-1.5 uppercase tracking-wider">
                    <span>Resultado Aplicado para el Cliente ({previewClient.name}):</span>
                    <span className="text-slate-400 font-mono">Días de Mora: {previewClient.daysArrears} días</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-950 border border-emerald-900/50 text-xs font-sans text-slate-200 whitespace-pre-line leading-relaxed shadow-inner">
                    {replaceScriptVariables(selectedScript.templateText, previewClient)}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
