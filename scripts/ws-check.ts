/**
 * Checks the room WebSocket bridge without a browser: it starts the bridge on a
 * throwaway port and speaks the handshake by hand.
 *
 *   npm run ws:check
 *
 * Only the refusal side can be checked without a Clerk session — a real token is
 * what lets a socket authenticate and join a room, and that is `npm run api:smoke`
 * with CLERK_TEST_TOKEN plus the two-tab browser check.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { attachWebSocket } from './ws-server';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const results: string[] = [];
const check = (label: string, ok: boolean, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `   ${extra}` : ''}`);
};

/** resolves with the close code, or 0 when it never closed */
function closeCode(url: string, onOpen?: (socket: WebSocket) => void, timeoutMs = 6000): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      resolve(-1);
    }, timeoutMs);
    if (onOpen) socket.on('open', () => onOpen(socket));
    socket.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(0);
    });
  });
}

async function run(): Promise<void> {
  const server = createServer();
  const detach = attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `ws://127.0.0.1:${port}`;

  check('bridge listens', port > 0, String(port));

  const refused = await closeCode(`${base}/api/ws`, (socket) =>
    socket.send(JSON.stringify({ type: 'auth', token: 'not-a-token' }))
  );
  check('a bad token closes the socket 4401', refused === 4401, `got ${refused}`);

  const wrongPath = await closeCode(`${base}/api/other`);
  check('an upgrade on another path is refused', wrongPath === 0 || wrongPath === -1, `got ${wrongPath}`);

  // "join" before any authentication must not be answered: nothing may leak
  const silent = await new Promise<string>((resolve) => {
    const socket = new WebSocket(`${base}/api/ws`);
    let heard = '';
    const timer = setTimeout(() => {
      socket.close();
      resolve(heard || 'silent');
    }, 1500);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'join', roomId: 1 })));
    socket.on('message', (raw) => {
      heard = String(raw);
      clearTimeout(timer);
      socket.close();
      resolve(heard);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve('error');
    });
  });
  check('an unauthenticated join is ignored', silent === 'silent', silent);

  detach();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} SOCKET CHECKS PASSED`);
  if (failed) process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
