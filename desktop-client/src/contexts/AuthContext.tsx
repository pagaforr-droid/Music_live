import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SplashScreen } from '../components/SplashScreen';
import type { AppModuleId, TanduUserProfile } from '../types/userManagement';
import {
  canUserAccessModule,
  getLocalUserProfileByEmail,
  readManagedAuthSessionEmail,
  resolveOrBootstrapUserProfile,
  subscribeToUsersUpdated,
  writeManagedAuthSessionEmail,
} from '../services/userManagementService';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  userProfile: TanduUserProfile | null;
  authReady: boolean;
  canAccessModule: (moduleId: AppModuleId) => boolean;
  refreshUserProfile: () => Promise<void>;
  authenticateManagedSession: (profile: TanduUserProfile) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  userProfile: null,
  authReady: false,
  canAccessModule: () => false,
  refreshUserProfile: async () => {},
  authenticateManagedSession: () => {},
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

function buildSyntheticSessionFromProfile(profile: TanduUserProfile): {
  session: Session;
  user: User;
} {
  const syntheticUser: User = {
    id: profile.id,
    app_metadata: { provider: 'tandu_managed', role: profile.role },
    user_metadata: { full_name: profile.full_name, title: profile.title, role: profile.role },
    aud: 'authenticated',
    created_at: profile.created_at,
    email: profile.email,
    role: 'authenticated',
  };

  const syntheticSession: Session = {
    access_token: `tandu-managed-${profile.id}`,
    refresh_token: `tandu-refresh-${profile.id}`,
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    token_type: 'bearer',
    user: syntheticUser,
  };

  return { session: syntheticSession, user: syntheticUser };
}

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<TanduUserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(() => !isPublicBandRoute());

  const syncProfileForEmail = useCallback(async (email: string | null | undefined, activeSupabaseSession?: Session | null) => {
    if (!email) {
      const managedEmail = readManagedAuthSessionEmail();
      if (managedEmail) {
        const localProfile = getLocalUserProfileByEmail(managedEmail) || (await resolveOrBootstrapUserProfile(managedEmail));
        if (localProfile && localProfile.status === 'active') {
          const synthetic = buildSyntheticSessionFromProfile(localProfile);
          setSession(synthetic.session);
          setUser(synthetic.user);
          setUserProfile(localProfile);
          return;
        }
        writeManagedAuthSessionEmail(null);
      }
      setSession(null);
      setUser(null);
      setUserProfile(null);
      return;
    }

    // Immediate local resolution for zero-flicker UI, then async sync with Supabase table
    const immediateLocal = getLocalUserProfileByEmail(email);
    if (immediateLocal) {
      if (immediateLocal.status !== 'active') {
        writeManagedAuthSessionEmail(null);
        await supabase.auth.signOut().catch(() => {});
        setSession(null);
        setUser(null);
        setUserProfile(null);
        return;
      }
      setUserProfile(immediateLocal);
    }

    const resolved = await resolveOrBootstrapUserProfile(email);
    if (resolved.status !== 'active') {
      writeManagedAuthSessionEmail(null);
      await supabase.auth.signOut().catch(() => {});
      setSession(null);
      setUser(null);
      setUserProfile(null);
      return;
    }

    setUserProfile(resolved);
    if (activeSupabaseSession) {
      setSession(activeSupabaseSession);
      setUser(activeSupabaseSession.user);
    } else {
      const synthetic = buildSyntheticSessionFromProfile(resolved);
      setSession((prev) => prev || synthetic.session);
      setUser((prev) => prev || synthetic.user);
    }
  }, []);

  const refreshUserProfile = useCallback(async () => {
    const currentEmail = user?.email || readManagedAuthSessionEmail();
    await syncProfileForEmail(currentEmail, session);
  }, [session, syncProfileForEmail, user?.email]);

  const authenticateManagedSession = useCallback((profile: TanduUserProfile) => {
    if (profile.status !== 'active') return;
    writeManagedAuthSessionEmail(profile.email);
    const synthetic = buildSyntheticSessionFromProfile(profile);
    setUserProfile(profile);
    setSession(synthetic.session);
    setUser(synthetic.user);
    setAuthReady(true);
  }, []);

  useEffect(() => {
    const skipSplash = isPublicBandRoute();
    const startTime = Date.now();
    const MIN_LOADING_TIME = skipSplash ? 0 : 3000;

    supabase.auth
      .getSession()
      .then(async ({ data: { session: supaSession } }) => {
        if (supaSession?.user?.email) {
          writeManagedAuthSessionEmail(supaSession.user.email);
          await syncProfileForEmail(supaSession.user.email, supaSession);
        } else {
          await syncProfileForEmail(null, null);
        }
        setAuthReady(true);

        const elapsedTime = Date.now() - startTime;
        if (elapsedTime < MIN_LOADING_TIME) {
          setTimeout(() => {
            setLoading(false);
          }, MIN_LOADING_TIME - elapsedTime);
        } else {
          setLoading(false);
        }
      })
      .catch(async () => {
        await syncProfileForEmail(null, null);
        setAuthReady(true);
        const elapsedTime = Date.now() - startTime;
        setTimeout(() => {
          setLoading(false);
        }, Math.max(0, MIN_LOADING_TIME - elapsedTime));
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, supaSession) => {
      // Defer async Supabase queries outside GoTrue's internal navigator.locks callback to prevent deadlocks
      setTimeout(() => {
        if (supaSession?.user?.email) {
          writeManagedAuthSessionEmail(supaSession.user.email);
          void syncProfileForEmail(supaSession.user.email, supaSession);
        } else {
          const managedEmail = readManagedAuthSessionEmail();
          if (!managedEmail) {
            setSession(null);
            setUser(null);
            setUserProfile(null);
          } else {
            void syncProfileForEmail(managedEmail, null);
          }
        }
        setAuthReady(true);
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, [syncProfileForEmail]);

  // Listen to live user directory updates (status, role, or allowed_modules changes)
  useEffect(() => {
    return subscribeToUsersUpdated(() => {
      const activeEmail = user?.email || readManagedAuthSessionEmail();
      if (!activeEmail) return;
      const latestLocal = getLocalUserProfileByEmail(activeEmail);
      if (latestLocal) {
        if (latestLocal.status !== 'active') {
          writeManagedAuthSessionEmail(null);
          void supabase.auth.signOut().catch(() => {});
          setSession(null);
          setUser(null);
          setUserProfile(null);
        } else {
          setUserProfile(latestLocal);
        }
      }
    });
  }, [user?.email]);

  const canAccessModule = useCallback(
    (moduleId: AppModuleId): boolean => {
      return canUserAccessModule(userProfile, moduleId);
    },
    [userProfile]
  );

  const signOut = async () => {
    writeManagedAuthSessionEmail(null);
    setSession(null);
    setUser(null);
    setUserProfile(null);
    await supabase.auth.signOut().catch(() => {});
  };

  if (loading) {
    return <SplashScreen message="Preparando el entorno de trabajo..." />;
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        userProfile,
        authReady,
        canAccessModule,
        refreshUserProfile,
        authenticateManagedSession,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
