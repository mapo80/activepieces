import { test, expect } from '../../../fixtures';

test.describe('Agentic E07 — smoke baseline', () => {
  test('AP up and login persists session for app routes', async ({ page, request }) => {
    test.setTimeout(45_000);

    const flagsRes = await request.get('/api/v1/flags');
    expect(flagsRes.status()).toBe(200);
    const flags = await flagsRes.json();
    expect(flags['EDITION']).toBeDefined();

    await page.goto('/automations');
    await page.waitForURL(/.*\/automations/, { timeout: 15_000 });
    await expect(page).toHaveURL(/.*\/automations/);
  });
});
