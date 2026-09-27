import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'self'; connect-src 'self' http://localhost:4100 http://127.0.0.1:4100; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'${command === 'serve' ? " 'unsafe-inline'" : ''}; frame-ancestors http://localhost:5173 http://127.0.0.1:5173`,
    },
  },
}));
