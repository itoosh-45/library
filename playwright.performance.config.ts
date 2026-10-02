import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/performance', workers: 1, fullyParallel: false, timeout: 600000,
  outputDir: 'test-results/performance-artifacts',
  reporter: [['list'], ['json', { outputFile: 'test-results/performance-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4335/library/', browserName: 'chromium', actionTimeout: 15000, viewport: { width: 390, height: 844 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'node tests/pwa/server.mjs', env: { PWA_TEST_PORT: '4335' }, url: 'http://127.0.0.1:4335/library/', reuseExistingServer: false },
});
