import React, { useEffect, useState } from 'react';
import type { Agent, Country } from '../types';
import { AlertCircle, KeyRound, Loader2, Save, X } from 'lucide-react';

export interface AgentProfileUpdates {
  name: string;
  email: string;
  phone: string;
  country: Country;
  pbxExtension: string;
  password: string;
}

interface AgentProfileEditorProps {
  agent: Agent;
  onClose: () => void;
  onSave: (updates: AgentProfileUpdates) => Promise<Agent>;
}

export const AgentProfileEditor: React.FC<AgentProfileEditorProps> = ({ agent, onClose, onSave }) => {
  const [name, setName] = useState(agent.name);
  const [email, setEmail] = useState(agent.email);
  const [phone, setPhone] = useState(agent.phone);
  const [country, setCountry] = useState<Country>(agent.country);
  const [pbxExtension, setPbxExtension] = useState(agent.pbxExtension || '');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(agent.name);
    setEmail(agent.email);
    setPhone(agent.phone);
    setCountry(agent.country);
    setPbxExtension(agent.pbxExtension || '');
    setPassword('');
    setPasswordConfirmation('');
    setErrorMessage('');
  }, [agent]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage('');

    if (name.trim().length < 3) {
      setErrorMessage('El nombre debe tener al menos 3 caracteres.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage('Ingresa un correo válido.');
      return;
    }
    if (pbxExtension.trim() && !/^\d{4}$/.test(pbxExtension.trim())) {
      setErrorMessage('La extensión PBX debe tener exactamente 4 dígitos.');
      return;
    }
    if (!agent.authId && !password) {
      setErrorMessage('Este perfil aún no tiene cuenta de acceso. Define una contraseña inicial para crearla.');
      return;
    }
    if (password && password.length < 10) {
      setErrorMessage('La contraseña nueva debe tener al menos 10 caracteres.');
      return;
    }
    if (password && password !== passwordConfirmation) {
      setErrorMessage('Las contraseñas nuevas no coinciden.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        country,
        pbxExtension: pbxExtension.trim(),
        password,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudieron guardar los cambios.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/50 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-white">Editar perfil de agente</h3>
            <p className="mt-1 text-[11px] text-slate-400">Los cambios se guardan en Supabase.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-slate-300">
              Nombre completo
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-[11px] font-semibold text-slate-300">
              Correo electrónico
              <input
                required
                type="email"
                maxLength={150}
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-[11px] font-semibold text-slate-300">
              Teléfono
              <input
                type="tel"
                maxLength={30}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="text-[11px] font-semibold text-slate-300">
              País
              <select
                value={country}
                onChange={(event) => setCountry(event.target.value as Country)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              >
                <option value="SV">El Salvador</option>
                <option value="GT">Guatemala</option>
              </select>
            </label>
            <label className="text-[11px] font-semibold text-slate-300 sm:col-span-2">
              Extensión PBX
              <input
                inputMode="numeric"
                maxLength={4}
                value={pbxExtension}
                onChange={(event) => setPbxExtension(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 dígitos"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            </label>
          </div>

          <div className="rounded-xl border border-blue-900/60 bg-blue-950/20 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-blue-200">
              <KeyRound className="h-4 w-4" />
              Acceso a la plataforma
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
              {agent.authId
                ? 'La contraseña actual no se puede consultar. Deja estos campos vacíos para conservarla; complétalos para establecer una nueva.'
                : 'Este perfil todavía no tiene cuenta de inicio de sesión. Define y confirma una contraseña inicial para crearla.'}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-slate-300">
                {agent.authId ? 'Nueva contraseña' : 'Contraseña inicial'}
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={agent.authId ? 0 : 10}
                  maxLength={72}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={agent.authId ? 'Dejar vacía para no cambiar' : 'Mínimo 10 caracteres'}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-300">
                Confirmar contraseña
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={72}
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  placeholder="Vuelve a escribirla"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </label>
            </div>
          </div>

          {errorMessage && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/40 p-2.5 text-xs text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
            <button type="button" onClick={onClose} disabled={isSaving} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSaving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-60">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {isSaving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
