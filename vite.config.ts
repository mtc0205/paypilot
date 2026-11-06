import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src/web',
      '@shared': '/src/shared',
    },
  },
  build: {
    outDir: '../../dist/public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1800,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5075',
    },
  },
});
