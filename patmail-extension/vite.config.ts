import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyManifestPlugin } from './vite.manifest'

export default defineConfig({
  base: './',
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  publicDir: resolve(__dirname, '../public'),
  plugins: [vue(), copyManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        app: resolve(__dirname, 'app.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
})
