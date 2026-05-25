import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    exclude: ['node_modules', 'build', '.planning'],
    snapshotFormat: { printBasicPrototype: false },
    // 'forks' gives better isolation for fetch-based code paths
    pool: 'forks',
    // Smoke run (T-V01) has zero test files; later commits add them.
    // Without this flag vitest 4.x exits 1 even on an otherwise-clean run.
    passWithNoTests: true,
  },
});
