/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      include: ['src/lib/**', 'src/hooks/**', 'src/components/rioku/**', 'src/components/plugin/**', 'src/components/layout/**'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/components/ui/**',
        'src/routes/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/exports/**',
      ],
    },
    css: false,
  },
})
