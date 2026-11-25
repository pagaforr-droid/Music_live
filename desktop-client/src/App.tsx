import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight, Lock } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import type { AppModuleId } from './types/userManagement';
import {
  APP_MODULES,
  USER_ROLE_PRESETS,
  getFirstAllowedPathForUser,
} from './services/userManagementService';
import './App.css';

// Route-level code splitting to keep initial bundle compact and Vercel-friendly
const Login = lazy(() => import('./pages/Login'));
const LivePrompter = lazy(() => import('./pages/LivePrompter'));
const StemStudio = lazy(() => import('./pages/StemStudio'));
const SetlistBuilder = lazy(() => import('./pages/SetlistBuilder'));
const LiveConcert = lazy(() => import('./pages/LiveConcert'));
const MusicianPracticePlayer = lazy(() => import('./pages/MusicianPracticePlayer'));
const StageSoundcheck = lazy(() => import('./pages/StageSoundcheck'));
const MobileInEar = lazy(() => import('./pages/MobileInEar'));
const MusicHub = lazy(() => import('./pages/MusicHub'));
const AdminCMS = lazy(() => import('./pages/AdminCMS'));
const LaNacionDelLeon = lazy(() => import('./pages/LaNacionDelLeon'));
const BandContentStudio = lazy(() => import('./pages/BandContentStudio'));
const DesignTools = lazy(() => import('./pages/DesignTools'));
const LyricStudio = lazy(() => import('./pages/LyricStudio'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const StudioMasteringModule = lazy(() =>
  import('./modules/mastering-pro/components/MasteringRack').then((m) => ({
    default: m.StudioMasteringModule,
  }))
);
const SampleLabModule = lazy(() =>
  import('./modules/mastering-pro/sampler/components/SampleLabPanel').then((m) => ({
    default: m.SampleLabModule,
  }))
);

const RouteSuspenseFallback = () => (
  <div className="flex h-full min-h-[60vh] w-full items-center justify-center bg-[#0b0d13] text-zinc-400">
    <div className="flex flex-col items-center gap-3">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-[#e11d48]" />
      <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
        Cargando módulo...
      </span>
    </div>
  </div>
);

// Protected Route Wrapper
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, userProfile, authReady } = useAuth();
  if (!authReady || (session && !userProfile)) {
    return <RouteSuspenseFallback />;
  }
  if (!session || (userProfile && userProfile.status !== 'active')) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// Automatic Post-Load Dispatcher:
// - Administrator -> /studio (Stem Studio)
// - Musicians     -> /practice (Práctica MP3 Local Offline)
// - External HDMI Projector (?projector=1) -> /concert?projector=1
const DefaultRoleRedirect = () => {
  const { userProfile, authReady } = useAuth();
  const location = useLocation();

  if (!authReady || !userProfile) {
    return <RouteSuspenseFallback />;
  }

  if (new URLSearchParams(location.search).get('projector') === '1') {
    return <Navigate to={`/concert${location.search}`} replace />;
  }

  const targetPath = getFirstAllowedPathForUser(userProfile);
  return <Navigate to={targetPath === '/' ? '/studio' : targetPath} replace />;
};

// Module Permission Guard Wrapper
const ModuleGuard = ({
  moduleId,
  redirectHomeIfDenied = false,
  children,
}: {
  moduleId: AppModuleId;
  redirectHomeIfDenied?: boolean;
  children: React.ReactNode;
}) => {
  const { userProfile, canAccessModule, authReady } = useAuth();
  const navigate = useNavigate();

  if (!authReady) {
    return <RouteSuspenseFallback />;
  }

  if (canAccessModule(moduleId)) {
    return <>{children}</>;
  }

  const fallbackPath = getFirstAllowedPathForUser(userProfile);

  // When landing without access, redirect seamlessly to user's primary allowed module
  if (redirectHomeIfDenied && fallbackPath && fallbackPath !== '/') {
    return <Navigate to={fallbackPath} replace />;
  }

  const moduleDef = APP_MODULES.find((m) => m.id === moduleId);
  const roleLabel = userProfile ? USER_ROLE_PRESETS[userProfile.role]?.label : 'Usuario';

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0b0d13] p-6 text-white select-none">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#11141d] p-8 shadow-2xl">
        <div className="mb-5 flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
            <ShieldAlert size={24} />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-rose-400">
              Control de Acceso por Módulo
            </span>
            <h2 className="text-lg font-bold text-zinc-100">
              Acceso Restringido: {moduleDef?.label || moduleId}
            </h2>
          </div>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-zinc-400">
          Tu cuenta (<span className="font-medium text-zinc-200">{userProfile?.email}</span> · Rol:{' '}
          <span className="font-medium text-zinc-200">{roleLabel}</span>) no tiene habilitado el
          permiso para acceder al módulo{' '}
          <span className="font-semibold text-white">{moduleDef?.label || moduleId}</span>. Solicita
          la activación de este módulo al Administrador del sistema.
        </p>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800/80 pt-5">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Lock size={13} className="text-zinc-500" />
            <span>Módulos activos: {userProfile?.allowed_modules.length || 0}</span>
          </div>

          <button
            type="button"
            onClick={() => navigate(fallbackPath, { replace: true })}
            className="flex items-center gap-2 rounded-xl bg-[#e11d48] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#be123c] cursor-pointer"
          >
            <span>Ir a mi Módulo Principal</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

// Auth Route Wrapper (redirect to primary allowed module if already logged in)
const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, userProfile, authReady } = useAuth();
  if (!authReady || (session && !userProfile)) {
    return <RouteSuspenseFallback />;
  }
  if (session && userProfile && userProfile.status === 'active') {
    const targetPath = getFirstAllowedPathForUser(userProfile);
    return <Navigate to={targetPath} replace />;
  }
  return <>{children}</>;
};

function AppRoutes() {
  return (
    <Suspense fallback={<RouteSuspenseFallback />}>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthRoute>
              <Login />
            </AuthRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DefaultRoleRedirect />} />
          <Route
            path="/practice"
            element={
              <ModuleGuard moduleId="practice">
                <MusicianPracticePlayer />
              </ModuleGuard>
            }
          />
          <Route
            path="/concert"
            element={
              <ModuleGuard moduleId="concert">
                <LiveConcert />
              </ModuleGuard>
            }
          />
          <Route
            path="/soundcheck"
            element={
              <ModuleGuard moduleId="soundcheck">
                <StageSoundcheck />
              </ModuleGuard>
            }
          />
          <Route
            path="/editor"
            element={
              <ModuleGuard moduleId="editor">
                <LivePrompter />
              </ModuleGuard>
            }
          />
          <Route
            path="/studio"
            element={
              <ModuleGuard moduleId="studio">
                <StemStudio />
              </ModuleGuard>
            }
          />
          <Route
            path="/mastering"
            element={
              <ModuleGuard moduleId="mastering">
                <StudioMasteringModule />
              </ModuleGuard>
            }
          />
          <Route
            path="/sample-lab"
            element={
              <ModuleGuard moduleId="sample_lab">
                <SampleLabModule />
              </ModuleGuard>
            }
          />
          <Route
            path="/setlists"
            element={
              <ModuleGuard moduleId="setlists">
                <SetlistBuilder />
              </ModuleGuard>
            }
          />
          <Route
            path="/admin/cms"
            element={
              <ModuleGuard moduleId="nacion_cms">
                <AdminCMS />
              </ModuleGuard>
            }
          />
          <Route
            path="/nacion-cms"
            element={
              <ModuleGuard moduleId="nacion_cms">
                <BandContentStudio />
              </ModuleGuard>
            }
          />
          <Route
            path="/design"
            element={
              <ModuleGuard moduleId="design">
                <DesignTools />
              </ModuleGuard>
            }
          />
          <Route
            path="/lyrics"
            element={
              <ModuleGuard moduleId="lyrics">
                <LyricStudio />
              </ModuleGuard>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ModuleGuard moduleId="users_admin">
                <UserManagement />
              </ModuleGuard>
            }
          />
        </Route>

        {/* Public Band Websites */}
        <Route path="/lanacion_delleon_web" element={<LaNacionDelLeon />} />
        <Route path="/la-nacion-del-leon" element={<Navigate to="/lanacion_delleon_web" replace />} />
        <Route path="/la-nacion-del-leon-web" element={<Navigate to="/lanacion_delleon_web" replace />} />
        <Route path="/hub" element={<MusicHub />} />

        {/* Standalone Mobile Route */}
        <Route
          path="/mobile"
          element={
            <ProtectedRoute>
              <ModuleGuard moduleId="mobile_inear">
                <MobileInEar />
              </ModuleGuard>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
