import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  // Shared proxy configuration for cookie handling
  const createProxyConfig = (additionalOptions = {}) => ({
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    secure: false,
    // Rewrite cookies so they work with the Vite dev server
    cookieDomainRewrite: {
      '*': ''
    },
    cookiePathRewrite: {
      '*': '/'
    },
    ...additionalOptions
  });

  return {
    server: {
      port: 5173,
      strictPort: true, // Don't try other ports if 5173 is in use
      host: '0.0.0.0',
      proxy: {
        '/api': createProxyConfig(),
        '/img': createProxyConfig(),
        '/backgrounds': createProxyConfig(),
        '/characters': createProxyConfig(),
        '/user': createProxyConfig(),
        '/csrf-token': createProxyConfig(),
        // Proxy for local API (bypass CORS)
        '/local-api': {
          target: 'http://localhost:8045',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/local-api/, ''),
        },
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
