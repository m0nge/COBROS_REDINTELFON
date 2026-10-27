import React, { useState, useRef } from 'react';
import { Agent, Client, Country, PortfolioUploadResult } from '../types';
import { parsePortfolioFile, parsePastedText } from '../utils/portfolioUpload';
import {
  X,
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Users,
  Search,
  DollarSign,
  ShieldCheck,
  Building,
  RefreshCw,
  Layers,
  ArrowRight,
  Clipboard,
  Phone,
} from 'lucide-react';

interface PortfolioUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetAgent: Agent | null;
  agents: Agent[];
  currentCountry: Country;
  sapClients: Client[];
  onConfirmAssignment: (agentId: string, assignedClients: Client[], replace: boolean) => void;
}

export const PortfolioUploadModal: React.FC<PortfolioUploadModalProps> = ({
  isOpen,
  onClose,
  targetAgent,
  agents,
  currentCountry,
  sapClients,
  onConfirmAssignment,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(targetAgent?.id || '');
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [pastedText, setPastedText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [replaceMode, setReplaceMode] = useState<boolean>(true);
  const [uploadResult, setUploadResult] = useState<PortfolioUploadResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewFilter, setPreviewFilter] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedAgentId when targetAgent changes
  React.useEffect(() => {
    if (targetAgent) {
      setSelectedAgentId(targetAgent.id);
    } else if (agents.length > 0) {
      const firstActive = agents.find((a) => a.country === currentCountry && a.role === 'agente');
      if (firstActive) setSelectedAgentId(firstActive.id);
    }
  }, [targetAgent, agents, currentCountry]);

  if (!isOpen) return null;

  const currentAgent = agents.find((a) => a.id === selectedAgentId) || targetAgent || agents[0];
  const countryAgents = agents.filter((a) => a.country === currentCountry && a.role === 'agente');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const result = await parsePortfolioFile(file, currentCountry, sapClients);
      if (result.activeRowsParsed === 0) {
        setErrorMessage(
          'No se encontraron códigos de cliente válidos (ej. CL000519) en el archivo, o todos los registros estaban marcados como inactivos.'
        );
        setUploadResult(null);
      } else {
        setUploadResult(result);
      }
    } catch (err: any) {
      setErrorMessage(`Error al procesar el archivo: ${err.message || 'Formato no soportado'}`);
      setUploadResult(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcessPastedText = () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const result = parsePastedText(pastedText, currentCountry, sapClients);
      if (result.activeRowsParsed === 0) {
        setErrorMessage(
          'No se encontraron códigos de cliente en el texto pegado, o todos los clientes están inactivos.'
        );
        setUploadResult(null);
      } else {
        setUploadResult(result);
      }
    } catch (err: any) {
      setErrorMessage(`Error al procesar texto: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = () => {
    if (!uploadResult || !currentAgent) return;
    onConfirmAssignment(currentAgent.id, uploadResult.clients, replaceMode);
    handleClose();
  };

  const handleClose = () => {
    setUploadResult(null);
    setErrorMessage(null);
    setPastedText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const currencySymbol = currentCountry === 'SV' ? '$' : 'Q';

  const filteredPreview = (uploadResult?.clients || []).filter(
    (c) =>
      c.code.toLowerCase().includes(previewFilter.toLowerCase()) ||
      c.name.toLowerCase().includes(previewFilter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Subir y Asignar Cartera Manual por Agente</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-700/50">
                  {currentCountry === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Carga un archivo Excel (.xlsx / .csv) o PDF con <strong>código de cliente</strong> y <strong>nombre</strong>. Los datos se cruzan con SAP y los inactivos se omiten.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* 1. Selector de Agente Destino */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                Agente que recibirá esta cartera:
              </label>
              <p className="text-[11px] text-slate-400">
                Selecciona al agente individual a quien se le asignará esta lista de clientes.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {currentAgent && (
                <img
                  src={currentAgent.avatarUrl}
                  alt={currentAgent.name}
                  className="w-10 h-10 rounded-full border border-blue-500/60 object-cover shrink-0"
                />
              )}
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl glass-input text-white cursor-pointer min-w-[220px]"
              >
                {countryAgents.map((ag) => (
                  <option key={ag.id} value={ag.id} className="bg-slate-900 text-white">
                    {ag.name} (PBX: {ag.pbxExtension}) - {ag.country}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. Selector de Modo: Archivo vs Texto Pegado */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInputMode('file')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    inputMode === 'file'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Subir Archivo (Excel o PDF)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('paste')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    inputMode === 'paste'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                  }`}
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>Pegar Lista de Texto</span>
                </button>
              </div>

              <span className="text-[11px] text-slate-400 font-mono">
                Reconoce columnas: <strong className="text-blue-300">cod_cliente</strong> y <strong className="text-blue-300">nombre</strong>
              </span>
            </div>

            {inputMode === 'file' ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-8 text-center bg-slate-950/40 hover:bg-slate-900/60 transition-all cursor-pointer group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="p-4 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20 group-hover:scale-105 transition-transform">
                    <Upload className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">
                      Arrastra y suelta tu archivo aquí, o <span className="text-blue-400 underline underline-offset-4">haz clic para examinar</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Formatos soportados: <strong>Excel (.xlsx, .xls)</strong>, <strong>CSV (.csv)</strong> o <strong>PDF (.pdf)</strong>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-2">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Cruce automático con SAP
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> Exclusión automática de inactivos
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  rows={5}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Pega aquí las filas copiadas de Excel, PDF o correo. Ej:&#10;CL000002	TELEFONICA MOVILES EL SALVADOR&#10;CL000519	FIJAPRES S.A. DE C.V"
                  className="w-full p-3.5 text-xs font-mono rounded-xl glass-input text-white placeholder:text-slate-500 leading-relaxed"
                />
                <button
                  type="button"
                  onClick={handleProcessPastedText}
                  disabled={!pastedText.trim() || isProcessing}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Procesar Texto Pegado</span>
                </button>
              </div>
            )}
          </div>

          {/* Loader */}
          {isProcessing && (
            <div className="p-6 rounded-xl bg-slate-950/80 border border-blue-500/30 flex items-center justify-center gap-3 text-blue-300 text-xs font-bold animate-pulse">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Analizando documento, identificando columnas y cruzando con base SAP...</span>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 3. Resumen del Análisis del Archivo */}
          {uploadResult && (
            <div className="space-y-4 animate-fade-in">
              {/* Tarjetas de Métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Total Filas en Archivo
                  </div>
                  <div className="text-xl font-bold font-mono text-white mt-1">
                    {uploadResult.totalRowsFound}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                    {uploadResult.fileName}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40">
                  <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Clientes Activos
                  </div>
                  <div className="text-xl font-bold font-mono text-emerald-300 mt-1">
                    {uploadResult.activeRowsParsed}
                  </div>
                  <div className="text-[10px] text-emerald-400/80 mt-0.5">
                    Listos para asignar
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Inactivos Omitidos
                  </div>
                  <div className="text-xl font-bold font-mono text-amber-300 mt-1">
                    {uploadResult.inactiveRowsOmitted}
                  </div>
                  <div className="text-[10px] text-amber-400/80 mt-0.5">
                    Filtrados por estatus
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-blue-950/40 border border-blue-500/40">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Deuda Total Cartera
                  </div>
                  <div className="text-xl font-bold font-mono text-blue-300 mt-1">
                    {currencySymbol}{uploadResult.totalDebtCalculated.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-[10px] text-blue-400/80 mt-0.5">
                    {uploadResult.matchedInSapCount} cruzados en SAP
                  </div>
                </div>
              </div>

              {/* Banner informativo de exclusión de inactivos */}
              {uploadResult.inactiveRowsOmitted > 0 && (
                <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>Filtro de Estatus Aplicado:</strong> Se omitieron{' '}
                    <strong>{uploadResult.inactiveRowsOmitted} cliente(s) inactivos</strong> detectados en el archivo. Solo se asignarán los clientes con estatus activo al sistema.
                  </span>
                </div>
              )}

              {/* 4. Tabla de Vista Previa de Clientes Reconocidos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <Building className="w-3.5 h-3.5 text-blue-400" />
                    Vista Previa de Cartera ({filteredPreview.length} clientes)
                  </div>
                  <div className="relative w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Filtrar por código o nombre..."
                      value={previewFilter}
                      onChange={(e) => setPreviewFilter(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs rounded-lg glass-input text-white"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto max-h-56 rounded-xl border border-slate-800 shadow-inner">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 font-semibold uppercase text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Cód. Cliente</th>
                        <th className="py-2.5 px-3">Nombre Reconocido</th>
                        <th className="py-2.5 px-3 text-right">Saldo SAP</th>
                        <th className="py-2.5 px-3 text-center">Días Mora</th>
                        <th className="py-2.5 px-3">Estatus</th>
                        <th className="py-2.5 px-3">Contacto SAP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-medium text-slate-200">
                      {filteredPreview.slice(0, 50).map((c) => (
                        <tr key={c.code} className="hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-mono font-bold text-blue-400">
                            {c.code}
                          </td>
                          <td className="py-2 px-3 font-semibold truncate max-w-xs text-white">
                            {c.name}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-100">
                            {currencySymbol}{(c.totalDebt || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                (c.daysArrears || 0) > 60
                                  ? 'bg-amber-950 text-amber-300 border border-amber-800/50'
                                  : 'bg-blue-950 text-blue-300 border border-blue-800/50'
                              }`}
                            >
                              {c.daysArrears || 0}d
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                              ACTIVO
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                            {c.phone1 || c.celular || 'Por SAP'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 5. Opciones de Asignación */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Modo de Asignación de Cartera:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    onClick={() => setReplaceMode(true)}
                    className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      replaceMode
                        ? 'bg-blue-950/60 border-blue-500 text-white'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignMode"
                      checked={replaceMode}
                      onChange={() => setReplaceMode(true)}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-xs font-bold">Reemplazar Cartera del Agente (Recomendado)</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        El agente pasará a gestionar únicamente los {uploadResult.activeRowsParsed} clientes de este archivo.
                      </div>
                    </div>
                  </label>

                  <label
                    onClick={() => setReplaceMode(false)}
                    className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      !replaceMode
                        ? 'bg-blue-950/60 border-blue-500 text-white'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignMode"
                      checked={!replaceMode}
                      onChange={() => setReplaceMode(false)}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-xs font-bold">Añadir a la Cartera Existente</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Suma estos {uploadResult.activeRowsParsed} clientes a los que el agente ya tenía asignados.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {uploadResult ? (
              <span>
                Asignando a: <strong className="text-white">{currentAgent?.name}</strong> ·{' '}
                <strong className="text-blue-400">{uploadResult.activeRowsParsed} clientes activos</strong>
              </span>
            ) : (
              <span>Sube un archivo Excel o PDF para continuar</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={!uploadResult || uploadResult.activeRowsParsed === 0}
              onClick={handleConfirm}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-blue-600/30 transition-all cursor-pointer flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirmar y Asignar a {currentAgent?.name?.split(' ')[0]}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
