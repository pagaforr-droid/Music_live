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
      isSidebarOpen ? 'space-x-3.5 px-4' : 'justify-center px-0'
    } py-3 rounded-xl transition-all duration-200 ${
      isActive
        ? 'bg-gradient-to-r from-[#ef4444]/20 via-[#ef4444]/8 to-transparent text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] border border-[#ef4444]/25'
        : 'text-[#8e96a4] hover:bg-white/[0.04] hover:text-white border border-transparent font-normal'
    }`;

  return (
    <div className="flex h-screen bg-[#08090c] text-white overflow-hidden selection:bg-red-500/30 selection:text-white">
      {/* Sidebar Musiko.io + QClay Dark Neumorphism */}
      <nav
        className={`${
          isSidebarOpen ? 'w-64' : 'w-20'
        } flex flex-col h-full bg-[#0d0f14]/95 border-r border-white/[0.06] backdrop-blur-3xl relative z-20 shadow-[8px_0_32px_rgba(0,0,0,0.65)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}
      >
        {/* Top Window Bar Accents (Musiko.io Style) + Collapse Button */}
        <div
          className={`pt-3.5 pb-2 px-4 flex items-center ${
            isSidebarOpen ? 'justify-between' : 'justify-center'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]/80 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]/80" />
          </div>
          {isSidebarOpen && (
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="w-7 h-7 rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] flex items-center justify-center text-gray-400 hover:text-white transition-all"
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
            className="absolute -right-3 top-12 w-6 h-6 bg-[#161922] text-gray-400 border border-white/15 rounded-full flex items-center justify-center hover:text-white hover:border-[#ef4444]/50 hover:bg-[#1e222d] z-50 shadow-[0_4px_12px_rgba(0,0,0,0.8)] transition-all"
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
          <div className="relative w-11 h-11 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] flex items-center justify-center shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_20px_rgba(0,0,0,0.6)]">
            <div className="absolute inset-0.5 rounded-2xl border border-transparent border-t-[#ef4444]/80 border-r-[#ef4444]/50 opacity-90" />
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
              <span className="text-[10px] font-medium tracking-[0.22em] text-[#ef4444] uppercase mt-0.5">
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
                      isActive ? 'text-[#ef4444] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Live Concert</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#ef4444] rounded-l-full shadow-[0_0_12px_#ef4444]" />
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
                      isActive ? 'text-[#ef4444] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Setlists & Show</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#ef4444] rounded-l-full shadow-[0_0_12px_#ef4444]" />
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
                      isActive ? 'text-[#ef4444] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Stem Studio</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#ef4444] rounded-l-full shadow-[0_0_12px_#ef4444]" />
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
                      isActive ? 'text-[#ef4444] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Studio Prompter</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#ef4444] rounded-l-full shadow-[0_0_12px_#ef4444]" />
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
                      isActive ? 'text-[#ef4444] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Lyric Studio</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#ef4444] rounded-l-full shadow-[0_0_12px_#ef4444]" />
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
                      isActive ? 'text-[#ef4444] drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'text-[#8e96a4] group-hover:text-white'
                    }`}
                  />
                  {isSidebarOpen && <span className="text-[13px] tracking-tight whitespace-nowrap">Diseño & Stage</span>}
                  {isActive && (
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#ef4444] rounded-l-full shadow-[0_0_12px_#ef4444]" />
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
              } py-2.5 rounded-xl transition-all duration-200 text-[#8e96a4] hover:bg-white/[0.04] hover:text-white border border-dashed border-white/10 hover:border-[#ef4444]/40`}
              title="Abrir In-Ear (Modo Práctica Wi-Fi)"
            >
              <Headphones size={18} className="text-gray-400 group-hover:text-[#ef4444] shrink-0 transition-colors" />
              {isSidebarOpen && (
                <div className="flex flex-col leading-tight overflow-hidden">
                  <span className="font-medium text-xs text-zinc-200 whitespace-nowrap">In-Ear Monitor</span>
                  <span className="text-[9px] font-mono text-amber-400/90 uppercase tracking-wider">Práctica Wi-Fi</span>
                </div>
              )}
            </a>
          </div>
        </div>

        {/* Footer User Profile Capsule */}
        <div
          className={`p-3.5 border-t border-white/[0.06] bg-[#090b0f]/90 ${
            !isSidebarOpen && 'flex flex-col items-center justify-center'
          }`}
        >
          {isSidebarOpen ? (
            <div className="flex items-center space-x-3 mb-3 px-2 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-[#1e2330] to-[#2d3548] border border-white/15 flex items-center justify-center shrink-0 shadow-inner">
                <User size={15} className="text-white/90" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0d0f14] shadow-[0_0_6px_#10b981]" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-normal text-zinc-300 truncate">{user?.email}</span>
                <span className="text-[9.5px] font-mono font-medium text-emerald-400 tracking-wider">STAGE ONLINE</span>
              </div>
            </div>
          ) : (
            <div
              className="relative w-9 h-9 rounded-full bg-gradient-to-tr from-[#1e2330] to-[#2d3548] border border-white/15 flex items-center justify-center shrink-0 mb-3 shadow-inner"
              title={user?.email}
            >
              <User size={15} className="text-white/90" />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0d0f14]" />
            </div>
          )}

          <button
            onClick={signOut}
            className={`stage-tactile-btn flex items-center justify-center ${
              isSidebarOpen ? 'w-full space-x-2 py-2 px-4' : 'p-2.5'
            } bg-gradient-to-b from-[#ef4444]/15 to-[#ef4444]/5 hover:from-[#ef4444]/25 hover:to-[#ef4444]/15 text-red-400 hover:text-red-300 rounded-xl transition-all border border-[#ef4444]/25`}
            title="Cerrar Sesión"
          >
            <LogOut size={15} className="shrink-0" />
            {isSidebarOpen && <span className="text-xs font-medium tracking-wide whitespace-nowrap">Cerrar Sesión</span>}
          </button>
        </div>
      </nav>

      {/* Main Content Area with Subtle Obsidian Stage Ambient Glow */}
      <main className="flex-1 h-full relative overflow-hidden bg-[#08090c]">
        <div className="pointer-events-none absolute -top-40 right-1/4 w-[520px] h-[520px] rounded-full bg-[#ef4444]/[0.03] blur-[130px]" />
        <Outlet />
      </main>
    </div>
  );
}
