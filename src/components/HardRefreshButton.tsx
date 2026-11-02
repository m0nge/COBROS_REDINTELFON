import React, { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export const HardRefreshButton: React.FC = () => {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('__hardrefresh')) return;
    url.searchParams.delete('__hardrefresh');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);

  const handleHardRefresh = () => {
    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.set('__hardrefresh', String(Date.now()));
    window.location.replace(freshUrl.toString());
  };

  return (
    <button
      type="button"
      onClick={handleHardRefresh}
      title="Recarga la aplicación con una dirección nueva, sin borrar sesión ni datos guardados"
      aria-label="Hardrefresh: cargar la versión más reciente"
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/30 transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
    >
      <RefreshCw className="h-3.5 w-3.5" />
      <span>Hardrefresh</span>
    </button>
  );
};
