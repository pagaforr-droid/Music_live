import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import './App.css';

// Route-level code splitting to keep initial bundle compact and Vercel-friendly
const Login = lazy(() => import('./pages/Login'));
const LivePrompter = lazy(() => import('./pages/LivePrompter'));
const StemStudio = lazy(() => import('./pages/StemStudio'));
const SetlistBuilder = lazy(() => import('./pages/SetlistBuilder'));
const LiveConcert = lazy(() => import('./pages/LiveConcert'));
const StageSoundcheck = lazy(() => import('./pages/StageSoundcheck'));
const MobileInEar = lazy(() => import('./pages/MobileInEar'));
const MusicHub = lazy(() => import('./pages/MusicHub'));
const AdminCMS = lazy(() => import('./pages/AdminCMS'));
const LaNacionDelLeon = lazy(() => import('./pages/LaNacionDelLeon'));
const BandContentStudio = lazy(() => import('./pages/BandContentStudio'));
const DesignTools = lazy(() => import('./pages/DesignTools'));
const LyricStudio = lazy(() => import('./pages/LyricStudio'));
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
  const { session, authReady } = useAuth();
  if (!authReady) {
    return <RouteSuspenseFallback />;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// Auth Route Wrapper (redirect to home if already logged in)
const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, authReady } = useAuth();
  if (!authReady) {
    return <RouteSuspenseFallback />;
  }
  if (session) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

function AppRoutes() {
  return (
    <Suspense fallback={<RouteSuspenseFallback />}>
      <Routes>
        <Route path="/login" element={
          <AuthRoute>
            <Login />
          </AuthRoute>
        } />
        
        <Route element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="/" element={<LiveConcert />} />
          <Route path="/concert" element={<LiveConcert />} />
          <Route path="/soundcheck" element={<StageSoundcheck />} />
          <Route path="/editor" element={<LivePrompter />} />
          <Route path="/studio" element={<StemStudio />} />
          <Route path="/mastering" element={<StudioMasteringModule />} />
          <Route path="/sample-lab" element={<SampleLabModule />} />
          <Route path="/setlists" element={<SetlistBuilder />} />
          <Route path="/admin/cms" element={<AdminCMS />} />
          <Route path="/nacion-cms" element={<BandContentStudio />} />
          <Route path="/design" element={<DesignTools />} />
          <Route path="/lyrics" element={<LyricStudio />} />
        </Route>
        
        {/* Public Band Websites */}
        <Route path="/lanacion_delleon_web" element={<LaNacionDelLeon />} />
        <Route path="/la-nacion-del-leon" element={<Navigate to="/lanacion_delleon_web" replace />} />
        <Route path="/la-nacion-del-leon-web" element={<Navigate to="/lanacion_delleon_web" replace />} />
        <Route path="/hub" element={<MusicHub />} />

        {/* Standalone Mobile Route */}
        <Route path="/mobile" element={
          <ProtectedRoute>
            <MobileInEar />
          </ProtectedRoute>
        } />
        
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
