import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer de la app de escritorio.
// En dev sirve en localhost:5173 (lo carga electron/main.ts vía VITE_DEV_SERVER_URL).
// En build emite a dist/ con base relativa para que funcione desde file://.
// El dashboard web usa el servidor local (packages/server) en :3000 vía proxy /api.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
