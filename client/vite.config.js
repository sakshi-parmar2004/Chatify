import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // dist holds a built copy of the app; without this Vitest tries to collect
    // tests from the bundle
    exclude: ['node_modules/**', 'dist/**'],
  },
  server: {
    // Proxying keeps the client on relative URLs in every mode, so there is no
    // dev/prod branch to keep in sync and no cross-origin cookie handling in dev.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/socket.io': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
