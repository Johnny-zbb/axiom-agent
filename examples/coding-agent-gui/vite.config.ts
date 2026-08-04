import path from 'node:path';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'vite';

const src = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(src, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
  },
  build: {
    outDir: 'dist',
  },
  clearScreen: false,
});
