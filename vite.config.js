import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { join } from 'path'

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'
  const base = isProduction ? '/Quote/' : '/'

  return {
    plugins: [
      react(),
      // Plugin to copy index.html to 404.html for GitHub Pages SPA routing
      {
        name: 'copy-404',
        closeBundle() {
          if (isProduction) {
            try {
              const distPath = join(process.cwd(), 'dist')
              const indexPath = join(distPath, 'index.html')
              const notFoundPath = join(distPath, '404.html')
              copyFileSync(indexPath, notFoundPath)
              console.log('✓ Created 404.html for GitHub Pages')
            } catch (error) {
              console.error('Error creating 404.html:', error)
            }
          }
        }
      }
    ],
    base,
    server: {
      proxy: {
        '/api/video': {
          target: 'https://bold.webghostpiano.workers.dev',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/video/, ''),
        },
      },
    },
    build: {
      outDir: 'dist'
    }
  }
})

