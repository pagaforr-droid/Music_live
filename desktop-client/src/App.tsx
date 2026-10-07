import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import LivePrompter from './pages/LivePrompter';
import StemStudio from './pages/StemStudio';
import SetlistBuilder from './pages/SetlistBuilder';
import LiveConcert from './pages/LiveConcert';
import MobileInEar from './pages/MobileInEar';
import MusicHub from './pages/MusicHub';
import AdminCMS from './pages/AdminCMS';
import DesignTools from './pages/DesignTools';
import './App.css';

// Protected Route Wrapper
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session } = useAuth();
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// Auth Route Wrapper (redirect to home if already logged in)
const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { session } = useAuth();
  if (session) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

function AppRoutes() {
  return (
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
        <Route path="/editor" element={<LivePrompter />} />
        <Route path="/studio" element={<StemStudio />} />
        <Route path="/setlists" element={<SetlistBuilder />} />
        <Route path="/admin/cms" element={<AdminCMS />} />
        <Route path="/design" element={<DesignTools />} />
      </Route>
      
      {/* Public Landing Page */}
      <Route path="/hub" element={<MusicHub />} />

      {/* Standalone Mobile Route */}
      <Route path="/mobile" element={
        <ProtectedRoute>
          <MobileInEar />
        </ProtectedRoute>
      } />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
