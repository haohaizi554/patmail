import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Content Script 必须打成单个 IIFE，不能拆成页面里的 ES module。 */
export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/index.ts'),
      output: {
        format: 'iife',
        name: 'PatMailContent',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
        extend: true
      }
    }
  }
})
