import { Page, expect } from '@playwright/test';

export const assertions = {
  hasMcpGatewaySidebarEntry: async (page: Page) => {
    await page.goto('/platform/setup/ai');
    const link = page.locator('a[href="/platform/setup/mcp-gateways"]');
    await expect(link).toBeVisible({ timeout: 10_000 });
  },
  canOpenMcpGatewayPage: async (page: Page) => {
    await page.goto('/platform/setup/mcp-gateways');
    await page.waitForURL('**/platform/setup/mcp-gateways**', { timeout: 10_000 });
    await expect(page).toHaveURL(/.*\/platform\/setup\/mcp-gateways/);
  },
};
