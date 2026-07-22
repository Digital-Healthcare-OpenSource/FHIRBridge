import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: 'security',
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@fhirbridge/types': resolve(__dirname, '../../packages/types/src/index.ts'),
      '@fhirbridge/core': resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});
