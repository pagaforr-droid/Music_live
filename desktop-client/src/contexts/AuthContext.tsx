import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SplashScreen } from '../components/SplashScreen';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  authReady: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  authReady: false,
  signOut: async () => {},
});

const PUBLIC_WEB_PREFIXES = [
  '/lanacion_delleon_web',
  '/la-nacion-del-leon',
  '/la-nacion-del-leon-web',
  '/hub',
];

function isPublicBandRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  return PUBLIC_WEB_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(() => !isPublicBandRoute());

  useEffect(() => {
    const skipSplash = isPublicBandRoute();
    const startTime = Date.now();
    const MIN_LOADING_TIME = skipSplash ? 0 : 3000; // 3 segundos exactos de Splash Screen en rutas de estudio

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setAuthReady(true);

      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < MIN_LOADING_TIME) {
        setTimeout(() => {
          setLoading(false);
        }, MIN_LOADING_TIME - elapsedTime);
      } else {
        setLoading(false);
      }
    }).catch(() => {
      setAuthReady(true);
      const elapsedTime = Date.now() - startTime;
      setTimeout(() => {
        setLoading(false);
      }, Math.max(0, MIN_LOADING_TIME - elapsedTime));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return <SplashScreen message="Preparando el entorno de trabajo..." />;
  }

  return (
    <AuthContext.Provider value={{ session, user, authReady, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
