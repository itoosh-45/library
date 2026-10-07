import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['**/library-fixes.spec.ts'],
  reporter: [['list'], ['json', { outputFile: 'test-results/phone-browser-results.json' }]],
  projects: [{ name: 'Safari emulation', use: { ...devices['iPhone 13'], browserName: 'webkit', launchOptions: {} } }],
});
