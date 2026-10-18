import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.VITE_WSS_BASE_PATH || '/',
  plugins: [react()],
  optimizeDeps: { exclude: ['@aztec/bb.js', '@noir-lang/noir_js', '@noir-lang/acvm_js', '@noir-lang/noirc_abi'] },
  build: { rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), jb: resolve(import.meta.dirname, 'jb.html'), namu: resolve(import.meta.dirname, 'namu.html'), shinhan: resolve(import.meta.dirname, 'shinhan.html') } } },
  server: { host: '127.0.0.1' },
});
