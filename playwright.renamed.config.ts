import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/compatibility', testMatch: '**/renamed.spec.ts', workers: 1,
  outputDir: 'test-results/renamed-artifacts', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4337/renamed/', browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'node tests/pwa/server.mjs', url: 'http://127.0.0.1:4337/renamed/', reuseExistingServer: false,
    env: { PWA_TEST_DIST: 'private/phase17-renamed-dist', PWA_TEST_ALTERNATE_DIST: 'dist', PWA_TEST_BASE: '/renamed/', PWA_TEST_PORT: '4337' },
  },
});
