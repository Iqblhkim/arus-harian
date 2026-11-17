import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Client source lives in src/client; the built assets land in dist/client.
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Local dev: the Hono dev server (npm run dev:server) answers /api.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
