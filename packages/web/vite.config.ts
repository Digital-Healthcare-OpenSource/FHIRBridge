import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@fhirbridge/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // API dev server phục vụ path đầy đủ /api/v1/* trên :3001 — không rewrite.
    // API dev server serves the full /api/v1/* path on :3001 — no rewrite.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    // Playwright e2e (playwright.config.ts) boot API từ .env.test trên :3002.
    // Playwright e2e boots the API from .env.test on :3002.
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
