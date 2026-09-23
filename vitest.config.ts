import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: /^@upkeep\/sdk$/, replacement: path.resolve(__dirname, './packages/sdk/src/index.ts') },
      { find: /^@upkeep\/sdk\/(.*)$/, replacement: path.resolve(__dirname, './packages/sdk/src/$1') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
    ],
  },
});
