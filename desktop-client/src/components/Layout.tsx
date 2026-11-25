import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  MonitorPlay,
  CloudUpload,
  LogOut,
  User,
  Music,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Type,
  Headphones,
  Sliders,
  Grid,
  Activity,
  Disc3,
  Globe,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  Sparkles,
  Check,
  X,
  Menu,
  Smartphone,
} from 'lucide-react';
import { TanduMusicosLogo } from './TanduMusicosLogo';
import {
  USER_ROLE_PRESETS,
  changeTanduUserPassword,
  evaluatePasswordStrength,
  generateStrongPassword,
} from '../services/userManagementService';

export default function Layout() {
  const { user, userProfile, canAccessModule, refreshUserProfile, signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Retracted by default for more space
  const location = useLocation();
  const isProjectorWindow = new URLSearchParams(location.search).get('projector') === '1';

  // Self-service & forced password change modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwdText, setShowPwdText] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const isForcedPasswordChange = Boolean(userProfile?.must_change_password);

  useEffect(() => {
    if (isForcedPasswordChange) {
      setShowPasswordModal(true);
    }
  }, [isForcedPasswordChange]);

  // Open sidebar automatically when returning from standalone views (e.g. MobileInEar),
  // otherwise auto-close mobile drawer after tapping any module link on phones
  useEffect(() => {
    if ((location.state as { openSidebar?: boolean } | null)?.openSidebar) {
      setIsSidebarOpen(true);
      return;
    }
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, [location.pathname, location.state]);

  if (isProjectorWindow) {
    return (
      <div className="h-screen w-screen bg-black text-white overflow-hidden">
        <Outlet />
      </div>
    );
  }

  const handleSelfPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setPwdError(null);

    if (newPassword.length < 6) {
      setPwdError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('La confirmación de contraseña no coincide.');
      return;
    }

    setPwdSaving(true);
    try {
      await changeTanduUserPassword({
        userId: userProfile.id,
        targetEmail: userProfile.email,
        newPassword,
        isSelfChange: true,
        actorEmail: userProfile.email,
      });
      await refreshUserProfile();
      setPwdSuccess(true);
      setTimeout(() => {
        setPwdSuccess(false);
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordModal(false);
      }, 1100);
    } catch (err: any) {
      setPwdError(err?.message || 'Error al actualizar la contraseña.');
    } finally {
      setPwdSaving(false);
    }
  };

  const handleGenerateSelfPassword = () => {
    const generated = generateStrongPassword(12);
    setNewPassword(generated);
    setConfirmPassword(generated);
    setShowPwdText(true);
    setPwdError(null);
  };

  const pwdStrength = evaluatePasswordStrength(newPassword);

  const hasEscenarioGroup =
    canAccessModule('practice') ||
    canAccessModule('concert') ||
    canAccessModule('setlists') ||
    canAccessModule('soundcheck');
  const hasEstudioGroup =
    canAccessModule('studio') ||
    canAccessModule('mastering') ||
    canAccessModule('sample_lab') ||
    canAccessModule('editor') ||
    canAccessModule('lyrics') ||
    canAccessModule('design');
  const hasNacionCmsGroup = canAccessModule('nacion_cms');
  const hasMobileInEarGroup = canAccessModule('mobile_inear');
  const hasUsersAdminGroup = canAccessModule('users_admin');

  const rolePreset = userProfile ? USER_ROLE_PRESETS[userProfile.role] : null;

  const navLinkClass = (isActive: boolean) =>
    `group relative flex items-center ${
      isSidebarOpen ? 'space-x-3.5 px-3.5' : 'justify-center px-0'
    } py-2.5 rounded-xl transition-colors duration-150 ${
      isActive
        ? 'bg-[#1e1318] text-white font-semibold border border-[#e11d48]'
        : 'text-[#8e96a4] hover:bg-[#151924] hover:text-white border border-transparent font-normal'
    }`;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#0b0d13] text-white overflow-hidden selection:bg-[#e11d48]/30 selection:text-white">
      {/* Compact Top Bar for Mobile Phones (< md) */}
      <div className="flex md:hidden items-center justify-between px-3.5 py-2.5 bg-[#0d0f16] border-b border-[#1a1e28] shrink-0 z-30">
        <button
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#151924] border border-[#232938] text-zinc-200 active:scale-95 transition-transform"
          aria-label="Abrir menú de módulos"
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-2">
          <TanduMusicosLogo animateEntrance={false} className="w-7 h-7" />
          <span className="text-xs font-bold tracking-wider text-zinc-100">TANDU</span>
          <span className="text-[10px] font-semibold tracking-widest text-rose-400">MUSICOS</span>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a1115] border border-[#e11d48]/30 text-[#f43f5e]"
          title="Cerrar Sesión"
        >
          <LogOut size={15} />
        </button>
      </div>

      {/* Mobile Drawer Backdrop */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[1px] md:hidden"
        />
      )}

      {/* Sidebar Musiko.io - Colores Enteros Sólidos (Drawer en celular, Rail fijo en tablet/PC) */}
      <nav
        className={`${
          isSidebarOpen
            ? 'fixed inset-y-0 left-0 z-50 flex w-64 md:relative md:z-30'
            : 'hidden md:flex md:relative md:z-30 md:w-20'
        } flex-col h-full bg-[#0d0f16] border-r border-[#1a1e28] shrink-0 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}
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

        {/* Floating Expand/Collapse Pill when retracted (Desktop/Tablet) */}
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="hidden md:flex absolute -right-3 top-12 w-6 h-6 bg-[#161922] text-gray-300 border border-white/20 rounded-full items-center justify-center hover:text-white hover:border-rose-500/60 hover:bg-[#1e222d] z-50 shadow-[0_4px_12px_rgba(0,0,0,0.8)] transition-all cursor-pointer"
            title="Expandir menú"
            aria-label="Expandir menú"
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

        {/* Navigation Menu Groups (Filtered by User Module Permissions) */}
        <div className="flex-1 py-4 px-3 space-y-5 overflow-y-auto custom-scrollbar">
          {/* Group 1: Escenario en Vivo & Práctica Local */}
          {hasEscenarioGroup && (
            <div className="space-y-1.5">
              {isSidebarOpen && (
                <div className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                  Escenario & Práctica
                </div>
              )}
              {canAccessModule('practice') && (
                <NavLink
                  to="/practice"
                  className={({ isActive }) => navLinkClass(isActive)}
                  title="Práctica MP3 Local (Memoria del Dispositivo)"
                >
                  {({ isActive }) => (
                    <>
                      <Smartphone
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-emerald-400' : 'text-emerald-400/80 group-hover:text-emerald-300'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">
                          Práctica MP3 Local
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-emerald-400 rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('concert') && (
                <NavLink to="/concert" className={({ isActive }) => navLinkClass(isActive)} title="Live Concert">
                  {({ isActive }) => (
                    <>
                      <MonitorPlay
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Live Concert</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('setlists') && (
                <NavLink to="/setlists" className={({ isActive }) => navLinkClass(isActive)} title="Setlists">
                  {({ isActive }) => (
                    <>
                      <ListMusic
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Setlists & Show</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('soundcheck') && (
                <NavLink
                  to="/soundcheck"
                  className={({ isActive }) => navLinkClass(isActive)}
                  title="Hardware & Soundcheck"
                >
                  {({ isActive }) => (
                    <>
                      <Activity
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Soundcheck & I/O</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}
            </div>
          )}

          {/* Group 2: Estudio & Producción */}
          {hasEstudioGroup && (
            <div className="space-y-1.5">
              {isSidebarOpen && (
                <div className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                  Estudio & Producción
                </div>
              )}
              {canAccessModule('studio') && (
                <NavLink to="/studio" className={({ isActive }) => navLinkClass(isActive)} title="Stem Studio">
                  {({ isActive }) => (
                    <>
                      <CloudUpload
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Stem Studio</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('mastering') && (
                <NavLink to="/mastering" className={({ isActive }) => navLinkClass(isActive)} title="Mastering Pro">
                  {({ isActive }) => (
                    <>
                      <Sliders
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Mastering Pro</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('sample_lab') && (
                <NavLink to="/sample-lab" className={({ isActive }) => navLinkClass(isActive)} title="Sample Lab">
                  {({ isActive }) => (
                    <>
                      <Grid
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Sample Lab</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('editor') && (
                <NavLink to="/editor" className={({ isActive }) => navLinkClass(isActive)} title="Studio Prompter">
                  {({ isActive }) => (
                    <>
                      <Music
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Studio Prompter</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('lyrics') && (
                <NavLink to="/lyrics" className={({ isActive }) => navLinkClass(isActive)} title="Lyric Studio">
                  {({ isActive }) => (
                    <>
                      <Type
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Lyric Studio</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}

              {canAccessModule('design') && (
                <NavLink
                  to="/design"
                  className={({ isActive }) => navLinkClass(isActive)}
                  title="Herramientas de Diseño"
                >
                  {({ isActive }) => (
                    <>
                      <Wand2
                        size={19}
                        className={`shrink-0 transition-colors ${
                          isActive ? 'text-[#e11d48]' : 'text-[#8e96a4] group-hover:text-white'
                        }`}
                      />
                      {isSidebarOpen && (
                        <span className="text-[13px] tracking-tight whitespace-nowrap">Diseño & Stage</span>
                      )}
                      {isActive && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#e11d48] rounded-l-full" />
                      )}
                    </>
                  )}
                </NavLink>
              )}
            </div>
          )}

          {/* Group 2B: Web Oficial & Contenido de la Banda */}
          {hasNacionCmsGroup && (
            <div className="space-y-1.5 pt-2 border-t border-white/[0.05]">
              {isSidebarOpen && (
                <div className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-[#ff7324]">
                  La Nación del León
                </div>
              )}
              <NavLink
                to="/nacion-cms"
                className={({ isActive }) => navLinkClass(isActive)}
                title="Gestor Web: Álbumes, Videos y Fotos"
              >
                {({ isActive }) => (
                  <>
                    <Disc3
                      size={19}
                      className={`shrink-0 transition-colors ${
                        isActive ? 'text-[#ff5412]' : 'text-[#ff7324]/80 group-hover:text-[#ff5412]'
                      }`}
                    />
                    {isSidebarOpen && (
                      <span className="text-[13px] tracking-tight whitespace-nowrap">
                        Contenido Web CMS
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#ff5412] rounded-l-full" />
                    )}
                  </>
                )}
              </NavLink>

              <a
                href="/lanacion_delleon_web"
                target="_blank"
                rel="noopener noreferrer"
                className={`group flex items-center ${
                  isSidebarOpen ? 'space-x-3 px-3.5' : 'justify-center px-0'
                } py-2.5 rounded-xl transition-all duration-200 text-[#8e96a4] hover:bg-[#1a120d] hover:text-white border border-dashed border-[#ff5412]/30 hover:border-[#ff5412]`}
                title="Abrir Web Pública (/lanacion_delleon_web)"
              >
                <Globe size={18} className="text-[#ff7324] group-hover:text-[#ff5412] shrink-0 transition-colors" />
                {isSidebarOpen && (
                  <div className="flex flex-col leading-tight overflow-hidden">
                    <span className="font-medium text-xs text-zinc-200 whitespace-nowrap">Web Pública ↗</span>
                    <span className="text-[9px] font-mono text-[#ff7324] tracking-wider truncate">
                      /lanacion_delleon_web
                    </span>
                  </div>
                )}
              </a>
            </div>
          )}

          {/* Group 3: Monitoreo Auxiliar */}
          {hasMobileInEarGroup && (
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
          )}

          {/* Group 4: Administración de Usuarios & Seguridad */}
          {hasUsersAdminGroup && (
            <div className="space-y-1.5 pt-2 border-t border-white/[0.05]">
              {isSidebarOpen && (
                <div className="px-3 pb-1 text-[9.5px] font-medium uppercase tracking-[0.2em] text-emerald-400">
                  Seguridad & Accesos
                </div>
              )}
              <NavLink
                to="/admin/users"
                className={({ isActive }) => navLinkClass(isActive)}
                title="Administración de Usuarios, Contraseñas y Accesos a Módulos"
              >
                {({ isActive }) => (
                  <>
                    <ShieldCheck
                      size={19}
                      className={`shrink-0 transition-colors ${
                        isActive ? 'text-emerald-400' : 'text-emerald-400/80 group-hover:text-emerald-300'
                      }`}
                    />
                    {isSidebarOpen && (
                      <span className="text-[13px] tracking-tight whitespace-nowrap">
                        Usuarios & Accesos
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-emerald-400 rounded-l-full" />
                    )}
                  </>
                )}
              </NavLink>
            </div>
          )}
        </div>

        {/* Footer User Profile Capsule */}
        <div
          className={`p-3.5 border-t border-[#1a1e28] bg-[#0d0f16] ${
            !isSidebarOpen && 'flex flex-col items-center justify-center'
          }`}
        >
          {isSidebarOpen ? (
            <div className="flex items-center justify-between mb-2.5 px-3 py-2 rounded-xl bg-[#12151f] border border-[#1f2533]">
              <div className="flex items-center space-x-2.5 overflow-hidden">
                <div className="relative w-8 h-8 rounded-full bg-[#1e2330] border border-[#2b3345] flex items-center justify-center shrink-0">
                  <User size={15} className="text-white/90" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-xs font-medium text-zinc-100 truncate">
                    {userProfile?.full_name || user?.email}
                  </span>
                  <span
                    className="text-[9.5px] font-mono font-medium tracking-wider truncate"
                    style={{ color: rolePreset?.badgeColor || '#34d399' }}
                  >
                    {rolePreset?.label.toUpperCase() || 'STAGE ONLINE'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPwdError(null);
                  setPwdSuccess(false);
                  setShowPasswordModal(true);
                }}
                className="p-1.5 rounded-lg bg-[#1a1f2e] hover:bg-[#252c40] text-zinc-400 hover:text-white border border-white/5 transition-colors shrink-0 cursor-pointer"
                title="Cambiar mi contraseña"
              >
                <KeyRound size={13} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 mb-2.5">
              <div
                className="relative w-9 h-9 rounded-full bg-[#1e2330] border border-[#2b3345] flex items-center justify-center shrink-0"
                title={`${userProfile?.full_name || ''} (${user?.email || ''})`}
              >
                <User size={15} className="text-white/90" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setPwdError(null);
                  setPwdSuccess(false);
                  setShowPasswordModal(true);
                }}
                className="p-2 rounded-xl bg-[#12151f] hover:bg-[#1c2130] text-zinc-400 hover:text-white border border-[#1f2533] transition-colors cursor-pointer"
                title="Cambiar mi contraseña"
              >
                <KeyRound size={14} />
              </button>
            </div>
          )}

          <button
            onClick={signOut}
            className={`flex items-center justify-center ${
              isSidebarOpen ? 'w-full space-x-2 py-2 px-4' : 'p-2.5'
            } bg-[#1a1115] hover:bg-[#25141c] text-[#f43f5e] hover:text-white rounded-xl transition-colors border border-[#e11d48]/30 cursor-pointer`}
            title="Cerrar Sesión"
          >
            <LogOut size={15} className="shrink-0" />
            {isSidebarOpen && (
              <span className="text-xs font-medium tracking-wide whitespace-nowrap">Cerrar Sesión</span>
            )}
          </button>
        </div>
      </nav>

      {/* Main Content Area - Entorno de Trabajo */}
      <main className="flex-1 min-h-0 h-full relative overflow-hidden bg-white">
        <Outlet />
      </main>

      {/* Self-Service / Forced Password Change Modal */}
      {showPasswordModal && userProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#10131c] p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
                  <KeyRound size={19} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {isForcedPasswordChange
                      ? 'Actualización de Contraseña Requerida'
                      : 'Cambiar Mi Contraseña'}
                  </h3>
                  <p className="text-xs text-zinc-400">{userProfile.email}</p>
                </div>
              </div>
              {!isForcedPasswordChange && (
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {isForcedPasswordChange && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
                El administrador asignó una contraseña temporal a tu cuenta. Por seguridad, define tu
                nueva contraseña personal para continuar.
              </div>
            )}

            <form onSubmit={handleSelfPasswordSubmit} className="mt-4 space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Nueva Contraseña</label>
                  <button
                    type="button"
                    onClick={handleGenerateSelfPassword}
                    className="flex items-center gap-1 text-[11px] font-medium text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                  >
                    <Sparkles size={12} />
                    <span>Generar Segura</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPwdText ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres..."
                    className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 pr-10 text-sm text-white focus:border-rose-500 focus:outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwdText((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPwdText ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {/* Password Strength Meter */}
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <div className="flex flex-1 items-center gap-1 pr-3">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className="h-1.5 flex-1 rounded-full transition-colors"
                        style={{
                          backgroundColor:
                            pwdStrength.score >= level ? pwdStrength.color : '#27272a',
                        }}
                      />
                    ))}
                  </div>
                  <span className="font-mono font-semibold" style={{ color: pwdStrength.color }}>
                    {pwdStrength.label}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Confirmar Contraseña
                </label>
                <input
                  type={showPwdText ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la nueva contraseña..."
                  className="w-full rounded-xl border border-zinc-800 bg-[#0b0d13] px-3.5 py-2.5 text-sm text-white focus:border-rose-500 focus:outline-none"
                  required
                />
              </div>

              {pwdError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                  {pwdError}
                </div>
              )}

              {pwdSuccess && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300">
                  <Check size={14} />
                  <span>Contraseña actualizada correctamente.</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                {!isForcedPasswordChange && (
                  <button
                    type="button"
                    onClick={() => setShowPasswordModal(false)}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={pwdSaving}
                  className="flex items-center gap-2 rounded-xl bg-[#e11d48] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#be123c] disabled:opacity-50 cursor-pointer"
                >
                  <KeyRound size={14} />
                  <span>{pwdSaving ? 'Guardando...' : 'Guardar Nueva Contraseña'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
