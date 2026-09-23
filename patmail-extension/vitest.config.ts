import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    environmentOptions: { jsdom: { url: 'https://example.test/forms?stage=1' } }
  }
})
