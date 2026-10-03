import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/compatibility', testMatch: '**/staging.spec.ts', workers: 1,
  outputDir: 'test-results/staging-artifacts', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4335/library/', browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4335 --strictPort --outDir private/phase19-staging-dist', url: 'http://127.0.0.1:4335/library/', reuseExistingServer: true },
});
