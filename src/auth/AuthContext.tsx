import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ClerkProvider, useAuth as useClerkAuth, useClerk, useUser } from '@clerk/react';
import { authApi, setTokenGetter } from './api';
import type { ApiStats, ApiUser } from './api';

/**
 * Why accounts may be unavailable:
 *  - 'none': everything is wired up
 *  - 'no-key': the server (and the build) have no Clerk publishable key
 *  - 'api': the /api functions did not answer, so nothing can be verified
 */
export type AccountProblem = 'none' | 'no-key' | 'api';

type AuthValue = {
  user: ApiUser | null;
  stats: ApiStats | null;
  loading: boolean;
  /** false when Clerk or the API is not configured (plain `npm run dev` without keys) */
  available: boolean;
  problem: AccountProblem;
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
  problem: 'no-key',
  refresh: async () => {},
  signIn: () => {},
  signOut: async () => {},
  setStats: () => {},
  recordRun: () => {},
});

/** a key baked into the build, when the deploy provided one at build time */
const BUILD_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim();

type Resolved = { key: string | null; problem: AccountProblem };

/**
 * The deploy may only expose the key at runtime (Vercel "Runtime" scope, or a
 * key added after the build). /api/config hands it over, so the browser does
 * not depend on what was present when Vite ran.
 */
function bootKey(): Promise<Resolved> {
  if (BUILD_KEY) return Promise.resolve({ key: BUILD_KEY, problem: 'none' });
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch('/api/config', { headers: { accept: 'application/json' }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`config ${response.status}`);
        const data = (await response.json()) as { clerkPublishableKey?: unknown };
        const key = typeof data.clerkPublishableKey === 'string' ? data.clerkPublishableKey.trim() : '';
        resolve({ key: key || null, problem: key ? 'none' : 'no-key' });
      })
      .catch(() => {
        // no JSON from /api: the functions are not deployed or not reachable
        resolve({ key: null, problem: 'api' });
      })
      .finally(() => clearTimeout(timer));
  });
}

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
      problem: reachable ? 'none' : 'api',
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
function GuestProvider({ children, problem }: { children: ReactNode; problem: AccountProblem }) {
  const value = useMemo<AuthValue>(
    () => ({
      user: null,
      stats: null,
      loading: false,
      available: false,
      problem,
      refresh: async () => {},
      signIn: () => {},
      signOut: async () => {},
      setStats: () => {},
      recordRun: () => {},
    }),
    [problem]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [resolved, setResolved] = useState<Resolved | null>(BUILD_KEY ? { key: BUILD_KEY, problem: 'none' } : null);

  useEffect(() => {
    if (resolved) return;
    let live = true;
    void bootKey().then((next) => {
      if (live) setResolved(next);
    });
    return () => {
      live = false;
    };
  }, [resolved]);

  // the editor must not mount twice while the key is being fetched, so hold the
  // shell back until the question "are accounts available?" has an answer
  if (!resolved) {
    return (
      <div style={{ padding: '48px', fontSize: '14px', opacity: 0.7 }} aria-busy="true">
        Loading Algo3D…
      </div>
    );
  }

  if (!resolved.key) return <GuestProvider problem={resolved.problem}>{children}</GuestProvider>;

  return (
    <ClerkProvider
      publishableKey={resolved.key}
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
