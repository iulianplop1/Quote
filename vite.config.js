import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Use '/' for development, '/Quote/' for production (GitHub Pages)
  base: mode === 'production' ? '/Quote/' : '/',
  build: {
    outDir: 'dist'
  }
}))

