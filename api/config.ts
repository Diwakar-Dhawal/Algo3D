/**
 * GET /api/config → the public runtime configuration for the browser.
 *
 * The Clerk publishable key is public by design (it ships to browsers), but it
 * may be configured on the server only — after a build, or with "Runtime"
 * scope in Vercel. Serving it here keeps sign-in working even when the key was
 * not present while Vite was building.
 *
 * Nothing secret belongs in this response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  const key =
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || process.env.CLERK_PUBLISHABLE_KEY?.trim() || '';
  res.statusCode = 200;
  res.end(JSON.stringify({ clerkPublishableKey: key || null }));
}
