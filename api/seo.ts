/**
 * /robots.txt and /sitemap.xml, generated from the request's own host.
 *
 * The site is one page served from whichever origin it is deployed on, and that
 * origin is known only at request time — writing the domain into a static file
 * would either be wrong or need a rebuild. Vercel rewrites both paths here (see
 * vercel.json), so the sitemap always names the address a crawler actually used.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

function origin(req: IncomingMessage): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim();
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https')
    .split(',')[0]
    .trim();
  return host ? `${proto}://${host}` : '';
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end('method not allowed');
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const base = origin(req);
  res.setHeader('cache-control', 'public, max-age=3600');

  if (url.searchParams.get('file') === 'sitemap') {
    res.setHeader('content-type', 'application/xml; charset=utf-8');
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
    );
    return;
  }

  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(
    `User-agent: *
Allow: /

# nothing under the API is a page
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`
  );
}
