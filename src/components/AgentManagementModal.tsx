import React, { useState } from 'react';
import { Agent, Country } from '../types';
import {
  X,
  UserPlus,
  Users,
  PhoneCall,
  Smartphone,
  Shield,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Building,
} from 'lucide-react';

interface AgentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  onAddAgent: (newAgent: {
    name: string;
    country: Country;
    pbxExtension: string;
    phone: string;
  }) => void;
  onDeleteAgent?: (agentId: string) => void;
}

export const AgentManagementModal: React.FC<AgentManagementModalProps> = ({
  isOpen,
  onClose,
  agents,
  onAddAgent,
  onDeleteAgent,
}) => {
  const [name, setName] = useState('');
  const [country, setCountry] = useState<Country>('SV');
  const [pbxExtension, setPbxExtension] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSuccessMsg('');

    const trimmedName = name.trim();
    const cleanPbx = pbxExtension.trim();
    const cleanPhone = phone.trim();

    if (!trimmedName) {
      setFormError('Por favor ingresa el nombre del agente.');
      return;
    }

    // Validate 4 digits for PBX extension
    if (!/^\d{4}$/.test(cleanPbx)) {
      setFormError('La extensión PBX debe contener exactamente 4 números (ej. 1024).');
      return;
    }

    if (!cleanPhone) {
      setFormError('Por favor ingresa el número de teléfono celular.');
      return;
    }

    // Check duplicate PBX
    const exists = agents.some((a) => a.pbxExtension === cleanPbx);
    if (exists) {
      setFormError(`La extensión PBX ${cleanPbx} ya está asignada a otro agente.`);
      return;
    }

    onAddAgent({
      name: trimmedName,
      country,
      pbxExtension: cleanPbx,
      phone: cleanPhone,
    });

    // Reset form
    setName('');
    setPbxExtension('');
    setPhone('');
    setSuccessMsg(`✓ Agente "${trimmedName}" registrado con éxito.`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Gestión de Agentes de Cobranza
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {agents.length} Registrados
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Administración de gestores, país asignado y extensiones telefónicas PBX
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Add Agent Form */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
              <UserPlus className="w-4 h-4 text-blue-400" />
              <span>Registrar Nuevo Agente</span>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-2.5 text-xs rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {successMsg && (
              <div className="flex items-center gap-2 p-2.5 text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Nombre */}
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej. Carlos Méndez"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* País */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  País Asignado *
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value as Country)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="SV">🇸🇻 El Salvador</option>
                  <option value="GT">🇬🇹 Guatemala</option>
                </select>
              </div>

              {/* Extensión PBX (4 dígitos) */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Extensión PBX (4 Dígitos) *
                </label>
                <div className="relative">
                  <PhoneCall className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={4}
                    value={pbxExtension}
                    onChange={(e) => setPbxExtension(e.target.value.replace(/\D/g, ''))}
                    placeholder="ej. 1024"
                    className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Teléfono Celular */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Teléfono Celular *
                </label>
                <div className="relative">
                  <Smartphone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="ej. 7890-1234"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Submit button */}
              <div className="sm:col-span-2 lg:col-span-4 flex justify-end pt-1">
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-600/30 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Guardar Agente</span>
                </button>
              </div>
            </form>
          </div>

          {/* List of Registered Agents */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Agentes Actuales en el Sistema</span>
              <span className="text-[11px] font-normal text-slate-500">
                La cartera de clientes se distribuye equitativamente entre los agentes activos
              </span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.map((ag) => (
                <div
                  key={ag.id}
                  className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 hover:border-slate-700 transition-all flex items-start justify-between gap-3 group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <img
                      src={ag.avatarUrl}
                      alt={ag.name}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover border border-slate-700 shrink-0"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">{ag.name}</span>
                        {ag.role === 'admin' ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <Shield className="w-2.5 h-2.5" /> Admin
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
                            Agente
                          </span>
                        )}
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {ag.country === 'SV' ? '🇸🇻 El Salvador' : '🇬🇹 Guatemala'}
                        </span>
                      </div>

                      {/* PBX and Phone */}
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1 font-mono font-medium text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-800/40">
                          <PhoneCall className="w-3 h-3 text-blue-400" />
                          PBX: {ag.pbxExtension || '—'}
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          <Smartphone className="w-3 h-3 text-emerald-400" />
                          {ag.phone}
                        </span>
                      </div>

                      {/* Portfolio count & efficiency */}
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 pt-0.5">
                        <span>{ag.assignedCount} clientes asignados</span>
                        <span>•</span>
                        <span className="text-emerald-400 font-medium">
                          {ag.effectivenessRate}% efectividad
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {onDeleteAgent && ag.role !== 'admin' && (
                    <button
                      onClick={() => onDeleteAgent(ag.id)}
                      title="Eliminar Agente"
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <span>Los agentes reciben distribución equitativa de su país asignado.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
