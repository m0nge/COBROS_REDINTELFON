import React, { useState } from 'react';
import { RedLogo } from './RedLogo';
import { Lock, Mail, ArrowRight, ShieldCheck, Loader2 } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      await onLogin(email.trim(), password);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-10 right-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <main className="relative z-10 w-full max-w-md rounded-2xl glass-panel border border-slate-700/80 p-8 shadow-2xl space-y-6">
        <header className="text-center space-y-2">
          <div className="inline-flex items-center justify-center mb-2">
            <RedLogo className="w-20 h-20 shadow-2xl shadow-red-950/80" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Cobranza Inteligente</h1>
          <p className="text-xs text-slate-400">Ingresa con el correo y contraseña de tu cuenta.</p>
        </header>

        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Correo electrónico</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.com"
                className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl glass-input placeholder:text-slate-500 font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Contraseña</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl glass-input placeholder:text-slate-500 font-medium"
              />
            </div>
          </div>

          {errorMsg && (
            <div role="alert" className="p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-300 text-xs">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>{isSubmitting ? 'Verificando…' : 'Iniciar sesión'}</span>
          </button>
        </form>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Acceso protegido por Supabase Auth. Si aún no tienes cuenta, pide al administrador que te habilite el acceso.
          </span>
        </div>
      </main>
    </div>
  );
};
