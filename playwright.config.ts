import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, fullyParallel: false,
  testMatch: ['**/simple-library.spec.ts', '**/gemini-key.spec.ts', '**/library-fixes.spec.ts', '**/goodreads.spec.ts'],
  outputDir: 'test-results/browser-artifacts',
  testIgnore: ['**/pwa/**', '**/performance/**', '**/compatibility/**'],
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4330/library/', browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4330/library/', reuseExistingServer: !process.env.CI },
});
