import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  build: { outDir: 'build', emptyOutDir: true },
  resolve: { alias: { '@': '/src' } },
})
