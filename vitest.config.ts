import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    // Prefer .ts over .js so Vitest uses TypeScript source, not stale compiled files
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    name: 'unit',
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/e2e/**/*.e2e.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['backend/**/*.ts', 'src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.js', 'node_modules'],
    },
    // Mock electron so backend modules can be tested without Electron running
    alias: {
      electron: path.resolve(__dirname, 'tests/__mocks__/electron.ts'),
    },
  },
})
