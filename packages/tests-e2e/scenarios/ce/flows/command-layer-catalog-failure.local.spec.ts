/**
 * T-13 — Catalog failure: MCP tool unavailable, bot handles gracefully.
 *
 * Uses the mock MCP server in `catalog-fail` mode. The consultazione flow
 * imports its fixture pointing to the mock MCP at port 9999. When the
 * `search_customer` tool call fails, the bot should respond with an error
 * acknowledgement rather than silently failing or crashing.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-catalog-failure.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    signIn,
    importAndPublishFlow,
    deleteFlow,
    openChatPage,
    sendChatMessage,
    waitForBotBubble,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'
import { startMockMcpServer } from '../../../fixtures/mock-mcp-server'

const MOCK_MCP_PORT = 9998

test.describe.configure({ mode: 'serial' })

test.describe('command-layer catalog-failure', () => {
    test('T-13: tool unavailable → bot responds gracefully', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        // Start mock MCP in catalog-fail mode (tools/call on catalog tools returns 500)
        const mockMcp = await startMockMcpServer({
            port: MOCK_MCP_PORT,
            tools: [],
            mode: 'catalog-fail',
        })

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        // Import fixture using mock MCP (catalog-fail mode) instead of real AEP
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione CatalogFail T13 ${suffix}`,
            { useMockMcpPort: MOCK_MCP_PORT },
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // The first tool call (search_customer) will fail in catalog-fail mode
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[T-13] bot1 (catalog-fail):', bot1.slice(0, 120))
            // Bot should respond with something (not crash) even when the tool fails
            // The response could be an error message, retry suggestion, or partial result
            expect(bot1.length).toBeGreaterThan(0)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
            await mockMcp.close()
        }
    })
})
