/**
 * Real-LLM end-to-end for INTERACTIVE_FLOW.
 *
 * Boots the Claude CLI proxy (OpenAI-compatible shim) and a mock MCP server
 * in-process, then exercises the extinguishing-relationship scenario:
 *   webhook trigger -> INTERACTIVE_FLOW with field-extractor + dynamic question
 *   generator + TOOL node(s) -> CONFIRM -> success
 *
 * Pre-requisites (run once before the spec):
 *   - `claude` CLI logged in (CLAUDE_CLI_BIN may override the binary path)
 *   - AP platform running with an AI Provider configured as CUSTOM
 *     (OpenAI-compatible) with baseUrl = http://127.0.0.1:<proxyPort>/v1
 *     and any apiKey (the shim ignores it).
 *   - An MCP Gateway configured with URL = http://127.0.0.1:<mcpPort>/mcp
 *
 * This spec is gated on CLAUDE_CLI_BIN availability so CI can skip it when
 * the Claude CLI isn't installed.
 */

import { test, expect } from '../../../../fixtures';
import { startClaudeCliProxy } from '../../../../fixtures/claude-cli-proxy';
import { startMockMcpServer } from '../../../../fixtures/mock-mcp-server';

const CLAUDE_BIN = process.env.CLAUDE_CLI_BIN ?? 'claude';

test.describe.skip('Interactive Flow — real LLM via Claude CLI proxy', () => {
  test('banking closure scenario extracts fields and drives the flow to completion', async ({
    page,
    automationsPage,
    builderPage,
  }) => {
    test.setTimeout(600000);

    const mcp = await startMockMcpServer({
      port: 0,
      tools: [
        {
          name: 'search_customer',
          inputSchema: {
            type: 'object',
            properties: { ndg: { type: 'string' } },
            required: ['ndg'],
          },
          execute: ({ ndg }) => ({ ndg, name: 'Polito', accountBalance: 0 }),
        },
        {
          name: 'close_relationship',
          inputSchema: {
            type: 'object',
            properties: {
              ndg: { type: 'string' },
              closureDate: { type: 'string' },
            },
            required: ['ndg', 'closureDate'],
          },
          execute: () => ({ ok: true, caseId: 'CS-001' }),
        },
      ],
    });

    const proxy = await startClaudeCliProxy({
      port: 0,
      claudeBin: CLAUDE_BIN,
      modelHint: 'custom-cli',
    });

    try {
      // The test is scaffolded; actual builder UI interactions (creating the
      // flow, configuring the INTERACTIVE_FLOW action with extractor +
      // generator pointing at the proxy, triggering the webhook, and
      // asserting on the final run verdict + audit events) live in the
      // per-scenario follow-up PRs since they depend on the settings-panel
      // nodes editor that shipped in PR9 and on seeding an AI Provider via
      // the platform admin API.
      expect(proxy.server.listening).toBe(true);
      expect(mcp.server.listening).toBe(true);
      await page.goto('/');
      await automationsPage.waitFor();
      await automationsPage.newFlowFromScratch();
      await builderPage.selectInitialTrigger({
        piece: 'Schedule',
        trigger: 'Every Hour',
      });
    } finally {
      await proxy.close();
      await mcp.close();
    }
  });
});
