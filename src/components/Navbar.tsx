import React from 'react';
import { Agent, AuthUser, Country } from '../types';
import { RedLogo } from './RedLogo';
import {
  Building2,
  Users,
  Sparkles,
  LogOut,
  Zap,
} from 'lucide-react';

interface NavbarProps {
  currentUser: AuthUser;
  onLogout: () => void;
  currentCountry: Country;
  onCountryChange: (c: Country) => void;
  onOpenSyncModal: () => void;
  onToggleMotorMora: () => void;
  isMotorMoraVisible: boolean;
  lastSyncTimestamp: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  onLogout,
  currentCountry,
  onCountryChange,
  onOpenSyncModal,
  onToggleMotorMora,
  isMotorMoraVisible,
  lastSyncTimestamp,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Zone */}
        <div className="flex items-center gap-3 shrink-0">
          <RedLogo className="w-10 h-10 hover:scale-105 transition-transform" />
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              Cobranza Inteligente
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400">
                SAP ERP
              </span>
            </h1>
          </div>
        </div>

        {/* Center Zone: Country Selector (SV / GT) */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center p-1 bg-slate-900/90 rounded-xl border border-slate-800">
            <button
              onClick={() => onCountryChange('SV')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                currentCountry === 'SV'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="El Salvador"
            >
              <span className="text-sm">🇸🇻</span>
              <span>El Salvador</span>
            </button>
            <button
              onClick={() => onCountryChange('GT')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                currentCountry === 'GT'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Guatemala"
            >
              <span className="text-sm">🇬🇹</span>
              <span>Guatemala</span>
            </button>
          </div>
        </div>

        {/* Right Zone: Sync status, Motor Mora, User Profile, Logout */}
        <div className="flex items-center gap-2.5">
          {/* Live Sync Status Button */}
          <button
            onClick={onOpenSyncModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 transition-all cursor-pointer"
            title="Sincronización en vivo con SAP"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-300 font-medium text-xs">
              Sync SAP
            </span>
          </button>

          {/* Motor de mora toggle */}
          <button
            onClick={onToggleMotorMora}
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
              isMotorMoraVisible
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Mostrar / ocultar motor de clasificación automática"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden xl:inline">Motor Mora</span>
          </button>

          {/* User Profile Badge */}
          <div className="flex items-center gap-2.5 pl-2 border-l border-slate-800">
            <img
              src={currentUser.avatarUrl}
              alt={currentUser.name}
              className="w-8 h-8 rounded-full border border-slate-700 object-cover"
            />
            <div className="hidden sm:block text-left">
              <div className="text-xs font-bold text-slate-100 flex items-center gap-1">
                <span>{currentUser.name}</span>
              </div>
              <div className="text-[10px] text-blue-400 font-semibold leading-none">
                {currentUser.role === 'admin' ? 'Administrador' : 'Agente de Cobro'}
              </div>
            </div>

            {/* Logout button */}
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
