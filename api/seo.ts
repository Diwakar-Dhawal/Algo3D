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
    // the app is one screen, but the topic pages under /topics/ are real
    // documents a crawler can read, so they are listed: long-tail queries
    // ("binary tree visualiser 3d") are where a new site can actually rank
    const pages: { path: string; freq: string; priority: string }[] = [
      { path: '/', freq: 'weekly', priority: '1.0' },
      { path: '/topics/arrays/', freq: 'monthly', priority: '0.8' },
      { path: '/topics/matrices/', freq: 'monthly', priority: '0.8' },
      { path: '/topics/stacks/', freq: 'monthly', priority: '0.8' },
      { path: '/topics/queues/', freq: 'monthly', priority: '0.8' },
      { path: '/topics/linked-lists/', freq: 'monthly', priority: '0.8' },
      { path: '/topics/binary-search-trees/', freq: 'monthly', priority: '0.8' },
      { path: '/topics/graphs/', freq: 'monthly', priority: '0.8' },
    ];
    const urls = pages
      .map(
        (page) =>
          `  <url>\n    <loc>${base}${page.path}</loc>\n    <changefreq>${page.freq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>`
      )
      .join('\n');
    res.setHeader('content-type', 'application/xml; charset=utf-8');
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
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
