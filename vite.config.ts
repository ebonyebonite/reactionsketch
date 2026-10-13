import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages のサブパスでも動くように相対パスで出力する
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, emptyOutDir: true },
  server: { port: 5175, strictPort: true },
});
