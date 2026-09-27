import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  server: {
    fs: {
      allow: [resolve(__dirname, '../src')]
    }
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    environmentOptions: { jsdom: { url: 'https://example.test/forms?stage=1' } }
  }
})
