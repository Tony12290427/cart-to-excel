import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  plugins: [react()],
  // Keep local server credentials outside the frontend environment loader.
  envDir: fileURLToPath(new URL('./frontend', import.meta.url)),
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.jsx'],
    restoreMocks: true,
    server: { deps: { external: [/\/platform\/lib\//] } },
  },
});
