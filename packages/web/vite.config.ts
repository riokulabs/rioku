import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [TanStackRouterVite(), tailwindcss(), react()],
  build: { outDir: 'build', emptyOutDir: true },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@rioku/ui': resolve(__dirname, '../ui/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7778',
        changeOrigin: true,
      },
    },
  },
})
