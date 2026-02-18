import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname),
      'openid-client@6': 'openid-client',
    },
  },
  esbuild: {
    tsconfigRaw: '{}',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['api/**/*.ts'],
    },
  },
})
