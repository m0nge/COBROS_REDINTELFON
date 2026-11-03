import React from 'react';
import { RefreshCw } from 'lucide-react';

export const HardRefreshButton: React.FC<{
  onRefresh: () => Promise<void>;
  isRefreshing?: boolean;
}> = ({ onRefresh, isRefreshing = false }) => {
  return (
    <button
      type="button"
      onClick={() => void onRefresh()}
      disabled={isRefreshing}
      title="Vuelve a cargar los agentes, asignaciones y cartera sin cerrar sesión"
      aria-label="Hardrefresh: actualizar cartera y asignaciones"
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/30 transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
      <span>Hardrefresh</span>
    </button>
  );
};
