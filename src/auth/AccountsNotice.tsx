import { useAuth } from './AuthContext';
import type { AccountProblem } from './AuthContext';

/**
 * Shown instead of the sign-in button when accounts cannot work. The two
 * causes need different fixes, so they get different text: a missing key is a
 * configuration problem, an unanswered /api is a deployment problem.
 */
export function AccountsNotice({ kind }: { kind: 'library' | 'rooms' }) {
  const problem: AccountProblem = useAuth().problem;
  const lead =
    kind === 'library'
      ? 'Saving programs needs an account.'
      : 'Rooms need accounts, so they are switched off here.';

  if (problem === 'no-key') {
    return (
      <div className="drawer-empty">
        <p>
          {lead} This deployment has no Clerk publishable key, so sign-in cannot start.
        </p>
        <p>
          Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> (or <code>CLERK_PUBLISHABLE_KEY</code>) to the project’s
          environment variables in Vercel and redeploy. For local work put it in <code>.env.local</code> and run{' '}
          <code>npm run dev:api</code> next to <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="drawer-empty">
      <p>
        {lead} The accounts API did not answer, so nobody can be signed in right now.
      </p>
      <p>
        On a deployment, check that the <code>api/</code> functions shipped and that <code>DATABASE_URL</code> and{' '}
        <code>CLERK_SECRET_KEY</code> are set. Locally, run <code>npm run dev:api</code> alongside{' '}
        <code>npm run dev</code>.
      </p>
    </div>
  );
}
