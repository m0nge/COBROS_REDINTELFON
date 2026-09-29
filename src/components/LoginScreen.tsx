import React, { useState } from 'react';
import { AuthUser } from '../types';
import { RedLogo } from './RedLogo';
import { Lock, User, ArrowRight, ShieldCheck, KeyRound, Sparkles, Building2, Users } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    if ((cleanUser === 'eduardo' || cleanUser === 'eduardo@red.com.sv') && cleanPass === '1234') {
      onLogin({
        id: 'user-eduardo',
        username: 'Eduardo',
        name: 'Eduardo',
        email: 'eduardo@red.com.sv',
        role: 'admin',
        country: 'SV',
        avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
      });
      return;
    }

    if ((cleanUser === 'maria' || cleanUser === 'maria@red.com.sv') && cleanPass === '1234') {
      onLogin({
        id: 'ag-maria',
        username: 'maria',
        name: 'María Rodríguez',
        email: 'maria@red.com.sv',
        role: 'agente',
        country: 'SV',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
      });
      return;
    }

    setErrorMsg('Credenciales inválidas. Usa Eduardo / 1234 o maria / 1234.');
  };

  const loginAs = (type: 'admin' | 'agente') => {
    if (type === 'admin') {
      onLogin({
        id: 'user-eduardo',
        username: 'Eduardo',
        name: 'Eduardo',
        email: 'eduardo@red.com.sv',
        role: 'admin',
        country: 'SV',
        avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
      });
    } else {
      onLogin({
        id: 'ag-maria',
        username: 'maria',
        name: 'María Rodríguez',
        email: 'maria@red.com.sv',
        role: 'agente',
        country: 'SV',
        avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-10 right-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md rounded-2xl glass-panel border border-slate-700/80 p-8 shadow-2xl space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center mb-2">
            <RedLogo className="w-20 h-20 shadow-2xl shadow-red-950/80" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Cobranza Inteligente</h1>
          <p className="text-xs text-slate-400">
            Ingresa con tus credenciales de Administrador o Agente de Cobros
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Usuario o Correo
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Eduardo o maria"
                className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl glass-input placeholder:text-slate-500 font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••"
                className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl glass-input placeholder:text-slate-500 font-medium font-mono"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-300 text-xs">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
          >
            <span>Iniciar Sesión</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Quick test buttons requested by user */}
        <div className="pt-4 border-t border-slate-800 space-y-2.5">
          <div className="text-[11px] font-semibold text-slate-400 text-center uppercase tracking-wider">
            Acceso Rápido de Prueba (1 Clic)
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => loginAs('admin')}
              className="p-3 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-blue-500/50 text-left transition-all group"
            >
              <div className="flex items-center gap-1.5 text-blue-400 font-bold text-xs mb-0.5">
                <Building2 className="w-3.5 h-3.5" />
                <span>Eduardo</span>
              </div>
              <div className="text-[11px] text-slate-400 font-medium">Administrador</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Clave: 1234</div>
            </button>

            <button
              type="button"
              onClick={() => loginAs('agente')}
              className="p-3 rounded-xl bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/50 text-left transition-all group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 text-indigo-400 font-bold text-xs">
                  <Users className="w-3.5 h-3.5" />
                  <span>María</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                  🇸🇻 SV
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-medium">Agente de Cobros</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Clave: 1234</div>
            </button>
          </div>
        </div>

        {/* Real data sync badge */}
        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Conectado a SAP & Supabase en tiempo real</span>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        </div>
      </div>
    </div>
  );
};
