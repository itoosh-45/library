import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: 'test-results/phone-artifacts',
  testMatch: ['**/library-fixes.spec.ts', '**/goodreads.spec.ts'],
  reporter: [['list'], ['json', { outputFile: 'test-results/phone-browser-results.json' }]],
  projects: [{ name: 'Safari emulation', use: { ...devices['iPhone 13'], browserName: 'webkit', launchOptions: {} } }],
});
