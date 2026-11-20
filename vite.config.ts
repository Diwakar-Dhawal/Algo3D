import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Leave the splitting to the dynamic imports: a named manual chunk here
        // gets a modulepreload tag in index.html, which puts three.js and
        // excalidraw back on first paint. React gets its own long-lived chunk.
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    // `npm run dev:api` serves the api/ functions on 3000
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // src/rooms/roles.ts re-exports api/rooms/_roles.ts, which Vite serves
        // as /api/rooms/_roles.ts. That is a source module, not an API call, so
        // let Vite answer it instead of forwarding it to the function server.
        bypass: (req) => (/\.(?:[cm]?[jt]sx?)$/.test((req.url ?? '').split('?')[0]) ? req.url : undefined),
      },
    },
  },
});
