import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MonitorPlay, CloudUpload, LogOut, User, Music, ListMusic, ChevronLeft, ChevronRight, Wand2, Type, Headphones } from 'lucide-react';
import { TanduMusicosLogo } from './SplashScreen';

export default function Layout() {
  const { user, signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Retracted by default for more space
  const location = useLocation();
  const isProjectorWindow = new URLSearchParams(location.search).get('projector') === '1';

  if (isProjectorWindow) {
    return (
      <div className="h-screen w-screen bg-black text-white overflow-hidden">
        <Outlet />
      </div>
    );
  }

  const navLinkClass = (isActive: boolean) =>
    `group relative flex items-center ${
      isSidebarOpen ? 'space-x-3.5 px-3.5' : 'justify-center px-0'
    } py-2.5 rounded-xl transition-colors duration-150 ${
      isActive
        ? 'bg-[#1e1318] text-white font-semibold border border-[#e11d48]'
        : 'text-[#8e96a4] hover:bg-[#151924] hover:text-white border border-transparent font-normal'
    }`;

  return (
    <div className="flex h-screen bg-[#0b0d13] text-white overflow-hidden selection:bg-[#e11d48]/30 selection:text-white">
      {/* Sidebar Musiko.io - Colores Enteros Sólidos */}
      <nav
        className={`${
          isSidebarOpen ? 'w-64' : 'w-20'
        } flex flex-col h-full bg-[#0d0f16] border-r border-[#1a1e28] relative z-20 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}
      >
        {/* Top Window Bar Accents (Colores Enteros, Cero Glow) + Collapse Button */}
        <div
          className={`pt-3.5 pb-2 px-4 flex items-center ${
            isSidebarOpen ? 'justify-between' : 'justify-center'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#e11d48]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
          </div>
          {isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="w-7 h-7 rounded-full bg-[#151924] hover:bg-[#1e2330] border border-[#232938] flex items-center justify-center text-gray-400 hover:text-white transition-all"
              title="Contraer menú"
            >
              <ChevronLeft size={14} />
            </button>
          )}
        </div>

        {/* Floating Expand/Collapse Pill when retracted */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute -right-3 top-12 w-6 h-6 bg-[#161922] text-gray-400 border border-white/15 rounded-full flex items-center justify-center hover:text-white hover:border-rose-500/50 hover:bg-[#1e222d] z-50 shadow-[0_4px_12px_rgba(0,0,0,0.8)] transition-all"
            title="Expandir menú"
          >
            <ChevronRight size={13} />
          </button>
        )}

        {/* Brand Identity Header */}
        <div
          className={`px-4 py-3.5 flex items-center ${
            isSidebarOpen ? 'space-x-3.5' : 'justify-center px-0'
          } border-b border-white/[0.06] transition-all`}
        >
          <div className="relative w-11 h-11 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.01] flex items-center justify-center shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_8px_20px_rgba(0,0,0,0.6)]">
            <div className="absolute inset-0.5 rounded-2xl border border-transparent border-t-rose-500/80 border-r-rose-500/50 opacity-90" />
            <TanduMusicosLogo animateEntrance={false} className="w-9 h-9" />
          </div>
          {isSidebarOpen && (
            <div className="flex flex-col leading-tight overflow-hidden">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-wider text-zinc-100">TANDU</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-zinc-300 font-medium tracking-wider">
                  /STAGE
                </span>
              </div>
              <span className="text-[10px] font-semibold tracking-[0.22em] text-rose-400 uppercase mt-0.5">
                MUSICOS
              </span>
            </div>
          )}
        </div>

        {/* Navigation Menu Groups */}
        <div className="flex-1 py-4 px-3 space-y-5 overflow-y-auto custom-scrollbar">
          {/* Group 1: Escenario en Vivo */}
          <div className="space-y-1.5">
            {isSidebarOpen && (
              <div className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                Escenario
              </div>
            )}
            <NavLink to="/" end className={({ isActive }) => navLinkClass(isActive)} title="Live Concert">
              {({ isActive }) => (
                <>
                  <MonitorPlay
                    size={19}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Live Concert</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                  )}
                </>
              )}
            </NavLink>

            <NavLink to="/setlists" className={({ isActive }) => navLinkClass(isActive)} title="Setlists">
              {({ isActive }) => (
                <>
                  <ListMusic
                    size={19}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Setlists & Show</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                  )}
                </>
              )}
            </NavLink>
          </div>

          {/* Group 2: Estudio & Producción */}
          <div className="space-y-1.5">
            {isSidebarOpen && (
              <div className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                Estudio & Producción
              </div>
            )}
            <NavLink to="/studio" className={({ isActive }) => navLinkClass(isActive)} title="Stem Studio">
              {({ isActive }) => (
                <>
                  <CloudUpload
                    size={19}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Stem Studio</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                  )}
                </>
              )}
            </NavLink>

            <NavLink to="/editor" className={({ isActive }) => navLinkClass(isActive)} title="Studio Prompter">
              {({ isActive }) => (
                <>
                  <Music
                    size={19}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Studio Prompter</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                  )}
                </>
              )}
            </NavLink>

            <NavLink to="/lyrics" className={({ isActive }) => navLinkClass(isActive)} title="Lyric Studio">
              {({ isActive }) => (
                <>
                  <Type
                    size={19}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Lyric Studio</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                  )}
                </>
              )}
            </NavLink>

            <NavLink to="/design" className={({ isActive }) => navLinkClass(isActive)} title="Herramientas de Diseño">
              {({ isActive }) => (
                <>
                  <Wand2
                    size={19}
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Diseño & Stage</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                  )}
                </>
              )}
            </NavLink>
          </div>

          {/* Group 3: Monitoreo Auxiliar */}
          <div className="pt-2 border-t border-white/[0.05]">
            <a
              href="/mobile"
              target="_blank"
              rel="noopener noreferrer"
              className={`group flex items-center ${
                isSidebarOpen ? 'space-x-3 px-3.5' : 'justify-center px-0'
              } py-2.5 rounded-xl transition-all duration-200 text-[#8e96a4] hover:bg-[#151924] hover:text-white border border-dashed border-[#232938] hover:border-[#e11d48]/50`}
              title="Abrir In-Ear (Modo Práctica Wi-Fi)"
            >
              <Headphones size={18} className="text-gray-400 group-hover:text-[#e11d48] shrink-0 transition-colors" />
              {isSidebarOpen && (
                <div className="flex flex-col leading-tight overflow-hidden">
                  <span className="font-medium text-xs text-zinc-200 whitespace-nowrap">In-Ear Monitor</span>
                  <span className="text-[9px] font-mono text-[#f59e0b] uppercase tracking-wider">Práctica Wi-Fi</span>
                </div>
              )}
            </a>
          </div>
        </div>

        {/* Footer User Profile Capsule */}
        <div
          className={`p-3.5 border-t border-[#1a1e28] bg-[#0d0f16] ${
            !isSidebarOpen && 'flex flex-col items-center justify-center'
          }`}
        >
          {isSidebarOpen ? (
            <div className="flex items-center space-x-3 mb-3 px-3 py-2 rounded-xl bg-[#12151f] border border-[#1f2533]">
              <div className="relative w-8 h-8 rounded-full bg-[#1e2330] border border-[#2b3345] flex items-center justify-center shrink-0">
                <User size={15} className="text-white/90" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-normal text-zinc-200 truncate">{user?.email}</span>
                <span className="text-[9.5px] font-mono font-medium text-emerald-400 tracking-wider">STAGE ONLINE</span>
              </div>
            </div>
          ) : (
            <div
              className="relative w-9 h-9 rounded-full bg-[#1e2330] border border-[#2b3345] flex items-center justify-center shrink-0 mb-3"
              title={user?.email}
            >
              <User size={15} className="text-white/90" />
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
            </div>
          )}

          <button
            onClick={signOut}
            className={`flex items-center justify-center ${
              isSidebarOpen ? 'w-full space-x-2 py-2 px-4' : 'p-2.5'
            } bg-[#1a1115] hover:bg-[#25141c] text-[#f43f5e] hover:text-white rounded-xl transition-colors border border-[#e11d48]/30`}
            title="Cerrar Sesión"
          >
            <LogOut size={15} className="shrink-0" />
            {isSidebarOpen && <span className="text-xs font-medium tracking-wide whitespace-nowrap">Cerrar Sesión</span>}
          </button>
        </div>
      </nav>

      {/* Main Content Area - Entorno de Trabajo con Fondo Blanco */}
      <main className="flex-1 h-full relative overflow-hidden bg-white">
        <Outlet />
      </main>
    </div>
  );
}
