import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: process.env.VITE_WSS_BASE_PATH || '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'self'; connect-src 'self' https://*.thirdweb.com https://*.thirdwebcdn.com http://localhost:4100 http://127.0.0.1:4100 ${process.env.VITE_WSS_BFF_URL ? new URL(process.env.VITE_WSS_BFF_URL).origin : ''}; img-src 'self' data: https://*.thirdwebcdn.com; frame-src https://*.thirdweb.com; style-src 'self' 'unsafe-inline'; script-src 'self'${command === 'serve' ? " 'unsafe-inline'" : ''}; frame-ancestors http://localhost:5173 http://127.0.0.1:5173`,
    },
  },
}));
