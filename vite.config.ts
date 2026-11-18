import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // `npx vercel dev --listen 3000` serves the api/ functions locally
    proxy: { '/api': 'http://localhost:3000' },
  },
});
