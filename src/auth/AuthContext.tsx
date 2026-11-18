import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ClerkProvider, useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react';
import { authApi, setTokenGetter } from './api';
import type { ApiStats, ApiUser } from './api';

type AuthValue = {
  user: ApiUser | null;
  stats: ApiStats | null;
  loading: boolean;
  /** false when Clerk or the API is not configured (plain `npm run dev` without keys) */
  available: boolean;
  refresh: () => Promise<void>;
  signIn: () => void;
  signOut: () => Promise<void>;
  setStats: (stats: ApiStats | null) => void;
  /** fire-and-forget: counts a run towards the daily streak */
  recordRun: () => void;
};

const AuthContext = createContext<AuthValue>({
  user: null,
  stats: null,
  loading: true,
  available: false,
  refresh: async () => {},
  signIn: () => {},
  signOut: async () => {},
  setStats: () => {},
  recordRun: () => {},
});

const PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim();

/** Signed in through Clerk: the browser gets a session token, the API verifies it. */
function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { openSignIn } = useClerk();
  const [profile, setProfile] = useState<ApiUser | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    setTokenGetter(getToken);
    return () => setTokenGetter(null);
  }, [getToken]);

  const refresh = async () => {
    const result = await authApi.me();
    if (!result) {
      setReachable(false);
      return;
    }
    setReachable(true);
    setProfile(result.user);
    setStats(result.stats);
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) void refresh();
    else {
      setProfile(null);
      setStats(null);
    }
  }, [isLoaded, isSignedIn]);

  const value = useMemo<AuthValue>(() => {
    const user: ApiUser | null =
      profile ??
      (clerkUser
        ? {
            id: 0,
            email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
            name: clerkUser.fullName ?? clerkUser.username ?? null,
            picture: clerkUser.imageUrl ?? null,
            createdAt: clerkUser.createdAt?.toISOString() ?? new Date().toISOString(),
          }
        : null);

    return {
      user,
      stats,
      loading: !isLoaded,
      available: reachable,
      refresh,
      signIn: () => {
        void openSignIn();
      },
      signOut: async () => {
        await signOut(() => {
          setProfile(null);
          setStats(null);
        });
      },
      setStats,
      recordRun: () => {
        if (!user) return;
        void authApi.record('run').then((result) => {
          if (result) setStats(result.stats);
        });
      },
    };
  }, [profile, clerkUser, stats, isLoaded, reachable, openSignIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** No publishable key yet: the lab keeps working, saving is simply switched off. */
function GuestProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthValue>(
    () => ({
      user: null,
      stats: null,
      loading: false,
      available: false,
      refresh: async () => {},
      signIn: () => {},
      signOut: async () => {},
      setStats: () => {},
      recordRun: () => {},
    }),
    []
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) return <GuestProvider>{children}</GuestProvider>;
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={{
        variables: { colorPrimary: '#b08d57', borderRadius: '8px' },
        elements: { card: 'clerk-card' },
      }}
    >
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

export const useAuth = () => useContext(AuthContext);
