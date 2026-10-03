import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/compatibility', workers: 1,
  testMatch: '**/previous.spec.ts',
  outputDir: 'test-results/compatibility-artifacts',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4330/library/', browserName: 'chromium', serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4330/library/', reuseExistingServer: !process.env.CI },
});
