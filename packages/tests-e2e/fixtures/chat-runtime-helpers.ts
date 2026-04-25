import { Page, expect } from '@playwright/test';
import { MockMcpMode, MockMcpTool, MockMcpServer, startMockMcpServer } from './mock-mcp-server';

const DEFAULT_MOCK_MCP_PORT = 9999;

export async function setupMockMcp({ mode, tools, port }: {
  mode?: MockMcpMode;
  tools?: MockMcpTool[];
  port?: number;
}): Promise<MockMcpServer> {
  return startMockMcpServer({
    port: port ?? DEFAULT_MOCK_MCP_PORT,
    tools: tools ?? [],
    mode,
  });
}

export async function openChatForFixture(page: Page, fixtureName: string): Promise<void> {
  await page.goto(`/flows?fixture=${encodeURIComponent(fixtureName)}`);
  await page.click('[data-testid="open-chat-button"]');
}

export async function sendUserMessage(page: Page, text: string): Promise<void> {
  await page.fill('[data-testid="chat-input"]', text);
  await page.keyboard.press('Enter');
}

export async function expectBotMessage(page: Page, regex: RegExp): Promise<void> {
  await expect(page.locator('[data-testid="bot-message"]').last()).toContainText(regex);
}

export async function expectActionTrace(page: Page, kinds: string[]): Promise<void> {
  for (const k of kinds) {
    await expect(page.locator(`[data-testid="chat-runtime-timeline-turn-${k}"]`)).toBeVisible();
  }
}

export async function expectPendingInteraction(page: Page, type: string): Promise<void> {
  await expect(page.locator(`[data-testid="pending-interaction-${type}"]`)).toBeVisible();
}

/**
 * Read the latest turn-log row for a given turnId.
 * Stub — implementation requires direct DB access (env-bound).
 */
export async function readDbTurnLog(turnId: string): Promise<{
  status: string;
  failedReason: string | null;
}> {
  throw new Error(
    `[chat-runtime-helpers] readDbTurnLog(${turnId}) is env-bound. ` +
    'Wire up via direct PG client (e.g. Pool from "pg") in dev-stack runs.',
  );
}

/**
 * Read outbox rows for a given turnId.
 * Stub — implementation requires direct DB access (env-bound).
 */
export async function readDbOutbox(turnId: string): Promise<Array<{
  outboxEventId: string;
  eventStatus: string;
  sessionSequence: string;
}>> {
  throw new Error(
    `[chat-runtime-helpers] readDbOutbox(${turnId}) is env-bound. ` +
    'Wire up via direct PG client (e.g. Pool from "pg") in dev-stack runs.',
  );
}
