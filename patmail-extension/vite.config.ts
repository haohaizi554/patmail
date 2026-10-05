import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Windows 上 cpSync 覆盖已有文件会抛出“操作已成功完成”，Chrome 占用时再重试几次。 */
async function copyManifest(from: string, to: string): Promise<void> {
  mkdirSync(dirname(to), { recursive: true })
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      copyFileSync(from, to)
      return
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      const message = error instanceof Error ? error.message : ''
      const retry = code === 'EBUSY' || code === 'EPERM' || code === 'UNKNOWN' || message.includes('operation completed successfully')
      if (!retry || attempt === 5) throw error
      await delay(200 * (attempt + 1))
    }
  }
}

export default defineConfig({
  base: './',
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  publicDir: resolve(__dirname, '../public'),
  plugins: [
    vue(),
    {
      name: 'copy-manifest',
      async closeBundle() {
        await copyManifest(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'))
      }
    }
  ],
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
