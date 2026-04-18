import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';

// Inlined from src/lib/csp.ts — vite.config.ts cannot import from src/ (project boundary).
// Keep in sync with src/lib/csp.ts devCsp() and randomNonce().
function randomNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function devCsp(nonce: string, viteHost: string, vitePort: number): string {
  return [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline'`,
    `connect-src 'self' ws://${viteHost}:${String(vitePort)} http://${viteHost}:${String(vitePort)}`,
  ].join('; ');
}

export default defineConfig(({ mode }) => {
  const isDev = mode !== 'production';
  const nonce = randomNonce();
  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
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
          manualChunks(id: string) {
            if (id.includes('@mantine/core') || id.includes('@mantine/hooks'))
              return 'mantine-core';
            if (
              id.includes('@tanstack/react-router') ||
              id.includes('@tanstack/react-query') ||
              id.includes('@tanstack/react-table')
            )
              return 'tanstack';
            if (id.includes('@scalar/api-reference-react')) return 'scalar';
            if (id.includes('@monaco-editor/react')) return 'monaco';
            if (id.includes('shiki')) return 'shiki';
            if (id.includes('@mantine/tiptap')) return 'tiptap';
            if (id.includes('cel-js')) return 'cel';
          },
        },
      },
    },
  };
});
