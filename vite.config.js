import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' — интерфейс открывается из файла (file://), а не с сервера
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, strictPort: true },
});
