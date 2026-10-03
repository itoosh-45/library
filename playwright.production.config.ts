import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/compatibility', testMatch: '**/production.spec.ts', workers: 1,
  outputDir: 'test-results/production-artifacts', reporter: [['list']],
  use: { baseURL: 'https://itoosh-45.github.io/library/', browserName: 'chromium', actionTimeout: 15000,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
});
