import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Redirect all file-writing tests to a temp dir via DATA_DIR env var,
    // so they can never pollute the real ./data/users.json etc.
    globalSetup: ['./src/test-setup.ts'],
    // Run tests sequentially to avoid file corruption when multiple tests
    // access the same users.json file
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
