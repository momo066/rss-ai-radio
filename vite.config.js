import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',   // Capacitor用に相対パスが必須
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
