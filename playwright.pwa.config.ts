import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa', workers: 1, fullyParallel: false,
  testMatch: ['**/handy-backup.spec.ts', '**/simple-offline.spec.ts', '**/security.spec.ts', '**/catalog-cover.spec.ts', '**/goodreads.spec.ts', '**/danacode.spec.ts', '**/nli.spec.ts', '**/gemini-key.spec.ts'],
  outputDir: 'test-results/pwa-artifacts',
  reporter: [['list'], ['json', { outputFile: 'test-results/pwa-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4334/library/', browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'node tests/pwa/server.mjs', url: 'http://127.0.0.1:4334/library/', reuseExistingServer: false },
});
