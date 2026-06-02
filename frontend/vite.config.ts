import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const zeroclawPort = env.VITE_ZEROCLAW_PORT || '42617';

  return {
    server: {
      port: 5173,
      strictPort: true,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${zeroclawPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: `ws://127.0.0.1:${zeroclawPort}`,
          ws: true,
          changeOrigin: true,
        },
        '/health': {
          target: `http://127.0.0.1:${zeroclawPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/pair': {
          target: `http://127.0.0.1:${zeroclawPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/admin': {
          target: `http://127.0.0.1:${zeroclawPort}`,
          changeOrigin: true,
          secure: false,
        },
      }
    },
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      clearMocks: true,
      include: ['**/*.{test,spec}.{ts,tsx}'],
      exclude: ['node_modules/**', 'dist/**', 'backend/**'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      }
    }
  };
});
