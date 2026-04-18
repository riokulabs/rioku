import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';
import { devCsp, randomNonce } from './src/lib/csp';

export default defineConfig(({ mode }) => {
  const isDev = mode !== 'production';
  const nonce = randomNonce();
  return {
    plugins: [
      TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
      react(),
      {
        name: 'rioku-csp-dev',
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            if (isDev) {
              res.setHeader('Content-Security-Policy', devCsp(nonce, 'localhost', 5173));
              res.setHeader('X-Rioku-CSP-Nonce', nonce);
              res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@rioku/plugin-sdk': fileURLToPath(new URL('./src/host/sdk.ts', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '0.0.0.0',
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'mantine-core': ['@mantine/core', '@mantine/hooks'],
            tanstack: ['@tanstack/react-router', '@tanstack/react-query', '@tanstack/react-table'],
            scalar: ['@scalar/api-reference-react'],
            monaco: ['@monaco-editor/react'],
            shiki: ['shiki'],
            tiptap: ['@mantine/tiptap'],
            cel: ['cel-js'],
          },
        },
      },
    },
  };
});
