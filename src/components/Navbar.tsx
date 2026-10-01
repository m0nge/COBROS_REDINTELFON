import React, { useMemo, useState } from 'react';
import { AuthUser, Country } from '../types';
import { RedLogo } from './RedLogo';
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  House,
  LogOut,
  Menu,
  Phone,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  Wallet,
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
  onOpenAgentModal?: () => void;
  agentsCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  onLogout,
  currentCountry,
  onCountryChange,
  onOpenSyncModal,
  onToggleMotorMora,
  isMotorMoraVisible,
  onOpenAgentModal,
  agentsCount,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [isCollapsed, setIsCollapsed] = useState(false);
  const userPbx = currentUser.role === 'agente' ? '1021' : undefined;

  const adminModules = useMemo(
    () => [
      { label: 'Inicio / Dashboard', icon: House },
      { label: 'Motor de Mora', icon: Sparkles },
      { label: 'Equipo de Cobro', icon: Users },
      { label: 'Constructor de Bitácora', icon: FileText },
      { label: 'Inteligencia de Negocio', icon: BarChart3 },
      { label: 'Clientes Críticos', icon: ShieldCheck },
      { label: 'Reportes', icon: BriefcaseBusiness },
      { label: 'Configuración', icon: UserCog },
    ],
    []
  );

  const agentModules = useMemo(
    () => [
      { label: 'Inicio / Resumen', icon: House },
      { label: 'Mi Cartera', icon: Wallet },
      { label: 'Lista de Gestión', icon: Users },
      { label: 'Acuerdos', icon: CircleDollarSign },
      { label: 'No Contactados', icon: Phone },
      { label: 'Reportes', icon: BriefcaseBusiness },
      { label: 'Motor de Mora', icon: Sparkles },
    ],
    []
  );

  const modules = isAdmin ? adminModules : agentModules;

  return (
    <aside
      className={`relative z-40 flex h-screen shrink-0 flex-col border-r border-slate-800/80 bg-[#080D1D] px-3 py-4 transition-all duration-300 ${
        isCollapsed ? 'w-[88px]' : 'w-[260px]'
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-slate-800/80 pb-4">
        <div className={`flex items-center gap-3 overflow-hidden ${isCollapsed ? 'justify-center w-full' : ''}`}>
          <RedLogo className="h-10 w-10 shrink-0" />
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">Cobranza Inteligente</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">SAP ERP</div>
            </div>
          )}
        </div>

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 text-slate-300 transition-colors hover:border-blue-500/40 hover:text-blue-300 md:inline-flex"
          aria-label={isCollapsed ? 'Expandir menú' : 'Contraer menú'}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className={`mb-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 ${isCollapsed ? 'px-2' : ''}`}>
        <div className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 ${isCollapsed ? 'hidden' : 'block'}`}>
          País
        </div>

        {isAdmin ? (
          <div className={`flex gap-2 ${isCollapsed ? 'flex-col' : 'flex-row'}`}>
            <button
              onClick={() => onCountryChange('SV')}
              className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2 text-[11px] font-semibold transition-all ${
                currentCountry === 'SV'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25'
                  : 'bg-slate-950 text-slate-300 hover:text-white'
              } ${isCollapsed ? 'w-full' : 'flex-1'}`}
              title="El Salvador"
            >
              <span>🇸🇻</span>
              {!isCollapsed && <span>El Salvador</span>}
            </button>
            <button
              onClick={() => onCountryChange('GT')}
              className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2 text-[11px] font-semibold transition-all ${
                currentCountry === 'GT'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25'
                  : 'bg-slate-950 text-slate-300 hover:text-white'
              } ${isCollapsed ? 'w-full' : 'flex-1'}`}
              title="Guatemala"
            >
              <span>🇬🇹</span>
              {!isCollapsed && <span>Guatemala</span>}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-2 py-2 text-[11px] font-semibold text-slate-200">
            <span>{currentCountry === 'SV' ? '🇸🇻' : '🇬🇹'}</span>
            {!isCollapsed && <span>{currentCountry === 'SV' ? 'El Salvador' : 'Guatemala'}</span>}
          </div>
        )}
      </div>

      <nav className="mt-2 flex-1 space-y-1.5">
        {modules.map(({ label, icon: Icon }) => {
          const isActive =
            (isAdmin && label === 'Inicio / Dashboard') ||
            (!isAdmin && label === 'Inicio / Resumen');

          return (
            <button
              key={label}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-blue-600/85 to-indigo-600/80 text-white shadow-lg shadow-blue-500/20'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title={label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-3 border-t border-slate-800/80 pt-3">
        <div className={`mb-3 flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <img
            src={currentUser.avatarUrl}
            alt={currentUser.name}
            className="h-10 w-10 rounded-full border border-slate-700 object-cover"
          />
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{currentUser.name}</div>
              <div className="text-[10px] text-blue-400 font-semibold">
                {isAdmin ? 'Administrador' : 'Agente de Cobro'}
              </div>
              {!isAdmin && userPbx && (
                <div className="text-[10px] text-slate-400">PBX: {userPbx}</div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onLogout}
          className={`flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:border-red-500/40 hover:text-red-300 ${isCollapsed ? 'justify-center px-0' : ''}`}
          title="Cerrar sesión"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span>Cerrar sesión</span>}
        </button>
      </div>

      {!isCollapsed && (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
          <Menu className="h-3.5 w-3.5" />
          Menú
        </div>
      )}
    </aside>
  );
};
