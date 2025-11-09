import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, copyFileSync } from 'fs'
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
            const distPath = join(process.cwd(), 'dist')
            const indexPath = join(distPath, 'index.html')
            const notFoundPath = join(distPath, '404.html')
            try {
              let indexContent = readFileSync(indexPath, 'utf-8')
              // Update paths in 404.html to work with GitHub Pages
              indexContent = indexContent.replace(/href="\//g, `href="${base}`)
              indexContent = indexContent.replace(/src="\//g, `src="${base}`)
              writeFileSync(notFoundPath, indexContent)
              console.log('✓ Created 404.html for GitHub Pages')
            } catch (error) {
              console.error('Error creating 404.html:', error)
            }
          }
        }
      }
    ],
    base,
    build: {
      outDir: 'dist'
    }
  }
})

