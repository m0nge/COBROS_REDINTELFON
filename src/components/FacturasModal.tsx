import React, { useState } from 'react';
import { X, Search, FileDown, ExternalLink, Filter } from 'lucide-react';
import { SanInvoice } from '../types';

interface FacturasModalProps {
  isOpen: boolean;
  onClose: () => void;
  filter: 'pendientes' | 'mes' | 'pagadas' | 'todas';
  invoices: SanInvoice[];
}

export const FacturasModal: React.FC<FacturasModalProps> = ({
  isOpen,
  onClose,
  filter: initialFilter,
  invoices,
}) => {
  const [activeFilter, setActiveFilter] = useState<'pendientes' | 'mes' | 'pagadas' | 'todas'>(initialFilter);
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const currentYearMonth = '2026-09';

  const filteredInvoices = invoices.filter((inv) => {
    // Status / date filtering
    const isPagado = (inv.estado || '').toUpperCase() === 'PAGADO';
    const isMes = (inv.fechaEmision || '').startsWith(currentYearMonth);

    if (activeFilter === 'pendientes' && isPagado) return false;
    if (activeFilter === 'pagadas' && !isPagado) return false;
    if (activeFilter === 'mes' && !isMes) return false;

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchDoc = (inv.numdoc || '').toLowerCase().includes(term);
      const matchEntry = (inv.DocEntry || '').toLowerCase().includes(term);
      const matchControl = (inv.num_control || '').toLowerCase().includes(term);
      const matchTipo = (inv.tipodoc || '').toLowerCase().includes(term);
      return matchDoc || matchEntry || matchControl || matchTipo;
    }

    return true;
  });

  const getTitle = () => {
    switch (activeFilter) {
      case 'pendientes':
        return 'Detalle de Facturas Pendientes (Monto Debiendo)';
      case 'mes':
        return 'Detalle de Facturas del Mes Actual';
      case 'pagadas':
        return 'Detalle de Facturas Pagadas';
      case 'todas':
      default:
        return 'Historial Integral de Facturas Emitidas';
    }
  };

  const totalFiltered = filteredInvoices.reduce(
    (acc, curr) => acc + (parseFloat(curr.valordoc) || 0),
    0
  );

  const totalPendientesGlobal = invoices
    .filter((i) => (i.estado || '').toUpperCase() === 'PENDIENTE')
    .reduce((acc, curr) => acc + (parseFloat(curr.valordoc) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-6xl bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2.5">
            <Search className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                {getTitle()}
              </h3>
              <p className="text-xs text-slate-500">
                Datos directos del sistema de facturación electrónica DTE (SAN / SAP)
              </p>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold font-mono">
              {filteredInvoices.length} facturas
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Filter Buttons */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveFilter('pendientes')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'pendientes'
                    ? 'bg-red-600 text-white font-bold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pendientes
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('pagadas')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'pagadas'
                    ? 'bg-emerald-600 text-white font-bold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pagadas
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('mes')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'mes'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mes Actual
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('todas')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeFilter === 'todas'
                    ? 'bg-slate-800 text-white font-bold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todas
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search bar inside modal */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por N° doc, tipo o control..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {filteredInvoices.length} mostradas de {invoices.length} totales
          </span>
        </div>

        {/* Modal Body: Invoices Table with Horizontal Scroll */}
        <div className="p-4 overflow-x-auto overflow-y-auto flex-1 bg-white">
          {filteredInvoices.length === 0 ? (
            <div className="text-center text-slate-500 py-12 text-sm font-medium">
              No se encontraron facturas para este filtro.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100/70">
                  <th className="py-2.5 px-3">DOCUMENTO</th>
                  <th className="py-2.5 px-2">TIPO</th>
                  <th className="py-2.5 px-2">EMISIÓN</th>
                  <th className="py-2.5 px-2">VENCIMIENTO</th>
                  <th className="py-2.5 px-3">VALOR TOTAL</th>
                  <th className="py-2.5 px-2">IVA</th>
                  <th className="py-2.5 px-2">NETO</th>
                  <th className="py-2.5 px-2">PAGO REGISTRADO</th>
                  <th className="py-2.5 px-2">FECHA PAGO</th>
                  <th className="py-2.5 px-2">ESTADO</th>
                  <th className="py-2.5 px-3">CONTROL DTE</th>
                  <th className="py-2.5 px-3 text-center">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredInvoices.map((inv, idx) => {
                  const isPagado = (inv.estado || '').toUpperCase() === 'PAGADO';
                  const valor = parseFloat(inv.valordoc) || 0;
                  const iva = parseFloat(inv.VatSum) || 0;
                  const neto = parseFloat(inv.valorneto) || 0;
                  const pago = parseFloat(inv.pago) || 0;
                  const pdfUrl = inv.url ? `https://san.red.com.sv/${inv.url}` : null;

                  return (
                    <tr key={inv.DocEntry || inv.DOCENTRY || idx} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-slate-900 font-mono">
                        {inv.numdoc || inv.DocEntry}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 font-mono text-xs">
                        {inv.tipodoc || 'CCF'}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 text-xs whitespace-nowrap">
                        {inv.fechaEmision}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 text-xs whitespace-nowrap">
                        {inv.fechavence}
                      </td>
                      <td className="py-2.5 px-3 font-extrabold text-slate-900 font-mono whitespace-nowrap">
                        ${valor.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 font-mono text-xs whitespace-nowrap">
                        ${iva.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 font-mono text-xs whitespace-nowrap">
                        ${neto.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 font-mono text-xs whitespace-nowrap">
                        ${pago.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 text-xs whitespace-nowrap">
                        {inv.Fecha_aplica_pago ? inv.Fecha_aplica_pago.split(' ')[0] : '-'}
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            isPagado
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {isPagado ? 'PAGADO' : 'PENDIENTE'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[10px] max-w-[150px] truncate" title={inv.num_control || inv.Codgen || ''}>
                        {inv.num_control || inv.Codgen || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {pdfUrl && (
                            <a
                              href={pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                              title="Descargar PDF Oficial"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {inv.link_pago && (
                            <a
                              href={inv.link_pago}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
                              title="Abrir Pasarela de Pago"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-5 text-slate-700">
            <div>
              <span className="text-slate-500">Total en lista: </span>
              <span className="font-bold text-slate-900 font-mono">
                ${totalFiltered.toFixed(2)}
              </span>
            </div>

            <div>
              <span className="text-slate-500">Saldo Pendiente Global: </span>
              <span className="font-bold text-red-600 font-mono">
                ${totalPendientesGlobal.toFixed(2)}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs transition-colors self-end sm:self-auto"
          >
            Cerrar Detalle
          </button>
        </div>
      </div>
    </div>
  );
};
