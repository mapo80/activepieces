import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

const BASE_URL = process.env.AP_FRONTEND_URL || 'http://localhost:18080';

const config: PlaywrightTestConfig = {
  testDir: './scenarios/ce',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: require.resolve('./global-setup'),
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: '@activepieces/ce',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
};

export default defineConfig(config);
