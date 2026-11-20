/**
 * Test-only stand-in for `@clerk/backend`, wired in by the `api:smoke` npm
 * script with `--alias:@clerk/backend=./scripts/clerk-test-stub.ts`.
 *
 * Why: the signed-in half of the API suite needed somebody to paste a Clerk
 * session token, so it skipped itself for everyone — and a harness bug that
 * swallowed every signed-in run hid there for months. A session cannot be minted
 * headless against a development Clerk instance (the ticket exchange needs a
 * browser), so the test identity is spelled `test:<clerk_user_id>` and resolved
 * here, against real rows in the real database.
 *
 * Anything that is not a test identity is handed to the real SDK, so the
 * "garbage bearer token is 401" checks still exercise Clerk itself. The stub is
 * never imported by the app: `vite build` and the deployed functions do not see
 * this file, and `test:` is not a token shape Clerk issues.
 */
import * as real from '../node_modules/@clerk/backend/dist/index.js';

/** the prefix that marks a token as a local test identity */
export const TEST_TOKEN_PREFIX = 'test:';

export function isTestToken(token: unknown): token is string {
  return typeof token === 'string' && token.startsWith(TEST_TOKEN_PREFIX);
}

export async function verifyToken(
  token: string,
  options?: Parameters<typeof real.verifyToken>[1]
): Promise<Awaited<ReturnType<typeof real.verifyToken>>> {
  if (isTestToken(token)) {
    const sub = token.slice(TEST_TOKEN_PREFIX.length).trim();
    if (!sub) throw new Error('empty test subject');
    // the shape `currentUser` reads: only `sub` matters to the API
    return { sub } as Awaited<ReturnType<typeof real.verifyToken>>;
  }
  // the real signature insists on an options object; an absent one means "defaults"
  return real.verifyToken(token, options ?? ({} as Parameters<typeof real.verifyToken>[1]));
}

export const createClerkClient = real.createClerkClient;
