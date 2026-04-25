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

type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

let cachedPool: PgPoolLike | null = null;

async function getPool(): Promise<PgPoolLike> {
  if (cachedPool) return cachedPool;
  const url = process.env.AP_TEST_DATABASE_URL ?? process.env.AP_POSTGRES_URL;
  if (!url) {
    throw new Error(
      '[chat-runtime-helpers] AP_TEST_DATABASE_URL not set. ' +
      'For dev-stack runs with PGLite, expose a debug REST endpoint instead. ' +
      'For Postgres dev-stack, set AP_TEST_DATABASE_URL=postgresql://...',
    );
  }
  // Optional dependency: install via `npm i pg` in tests-e2e if needed.
  // Imported lazily so the helpers module can be loaded even without pg installed.
  const pg = (await import('pg').catch(() => null)) as { Pool: new (cfg: { connectionString: string }) => PgPoolLike } | null;
  if (!pg) {
    throw new Error(
      '[chat-runtime-helpers] "pg" package not installed in tests-e2e. ' +
      'Run: npm i pg --save-dev --workspace=tests-e2e',
    );
  }
  cachedPool = new pg.Pool({ connectionString: url });
  return cachedPool;
}

/**
 * Read the latest turn-log row for a given turnId.
 *
 * Requires `AP_TEST_DATABASE_URL` env var pointing to the dev-stack's
 * Postgres (set when running playwright with a real PG instance, not PGLite).
 */
export async function readDbTurnLog(turnId: string): Promise<{
  status: string;
  failedReason: string | null;
}> {
  const pool = await getPool();
  const res = await pool.query(
    'SELECT "status", "failedReason" FROM "interactive_flow_turn_log" WHERE "turnId" = $1',
    [turnId],
  );
  if (res.rows.length === 0) {
    throw new Error(`[chat-runtime-helpers] turn ${turnId} not found in turn-log`);
  }
  const row = res.rows[0];
  return {
    status: String(row.status ?? ''),
    failedReason: row.failedReason === null || row.failedReason === undefined
      ? null
      : String(row.failedReason),
  };
}

/**
 * Read outbox rows for a given turnId, ordered by sessionSequence ascending.
 */
export async function readDbOutbox(turnId: string): Promise<Array<{
  outboxEventId: string;
  eventStatus: string;
  sessionSequence: string;
}>> {
  const pool = await getPool();
  const res = await pool.query(
    'SELECT "outboxEventId","eventStatus","sessionSequence" FROM "interactive_flow_outbox" WHERE "turnId" = $1 ORDER BY "sessionSequence" ASC',
    [turnId],
  );
  return res.rows.map((r) => ({
    outboxEventId: String(r.outboxEventId),
    eventStatus: String(r.eventStatus),
    sessionSequence: String(r.sessionSequence),
  }));
}
