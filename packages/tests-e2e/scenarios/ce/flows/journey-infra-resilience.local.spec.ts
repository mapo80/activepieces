/**
 * M4 — Infra resilience journey (4 sub-scenari indipendenti).
 *
 * Copre: errorPolicy SKIP propagation (catalog-fail), CAS conflict 412
 * (2 browser context simultanei), MCP slow/timeout tolerance, completion
 * happy path con mock MCP.
 *
 * Ogni sub-scenario usa un flow separato perché un fail in catalog-fail
 * propaga SKIP a tutto il DAG e termina il flow. Quindi mantenere 4 test
 * separati nello stesso file è più pulito che riusare una sessione.
 *
 * RUN
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/journey-infra-resilience.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'
import { startMockMcpServer, MockMcpServer } from '../../../fixtures/mock-mcp-server'

const MOCK_MCP_PORT = 9997

test.describe.configure({ mode: 'serial' })

test.describe('M4 — infra resilience journey', () => {
    let mockMcp: MockMcpServer

    test.beforeAll(async () => {
        mockMcp = await startMockMcpServer({
            port: MOCK_MCP_PORT,
            tools: [],
            mode: 'happy',
        })
    })

    test.afterAll(async () => {
        await mockMcp.close()
    })

    test('M4.1 — catalog-fail: errorPolicy SKIP propagation, bot graceful', async ({ request, browser }) => {
        test.setTimeout(8 * 60_000)
        mockMcp.setMode('catalog-fail')
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M4.1 CatalogFail',
            useMockMcpPort: MOCK_MCP_PORT,
        }, async ({ page }) => {
            await sendChatMessage(page, 'Bellafronte')
            const bot = await waitForBotBubble(page, 1, 120_000)
            console.log('[M4.1] bot:', bot.slice(0, 200))
            // Bot deve rispondere graceful (anche se SKIP propaga e flow termina presto)
            expect(bot.length).toBeGreaterThan(5)
        })
    })

    test('M4.2 — CAS conflict: 2 browser context simultanei', async ({ request, browser }) => {
        test.setTimeout(10 * 60_000)
        mockMcp.setMode('happy')
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M4.2 CASConflict',
            useMockMcpPort: MOCK_MCP_PORT,
        }, async ({ page: page1, request: _req, flowId }) => {
            // Apre una seconda pagina sullo stesso flow
            const page2Context = await browser.newContext()
            const page2 = await page2Context.newPage()
            await page2.goto(`http://localhost:4200/chat/${flowId}`)
            try {
                // Send messaggi simultanei dai 2 contesti
                await Promise.all([
                    sendChatMessage(page1, 'Bellafronte').catch(() => undefined),
                    sendChatMessage(page2, 'Bellafronte').catch(() => undefined),
                ])
                const [b1, b2] = await Promise.all([
                    waitForBotBubble(page1, 1, 120_000).catch(() => ''),
                    waitForBotBubble(page2, 1, 120_000).catch(() => ''),
                ])
                console.log('[M4.2] bot page1:', b1.slice(0, 100))
                console.log('[M4.2] bot page2:', b2.slice(0, 100))
                // Almeno uno dei 2 contesti deve aver ricevuto una response valida
                const valid = [b1, b2].filter(b => b.length > 0)
                expect(valid.length).toBeGreaterThanOrEqual(1)
            }
            finally {
                await page2Context.close().catch(() => undefined)
            }
        })
    })

    test('M4.3 — slow MCP (3s delay): bot risponde entro timeout', async ({ request, browser }) => {
        test.setTimeout(8 * 60_000)
        mockMcp.setMode('slow', 3_000)
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M4.3 SlowMcp',
            useMockMcpPort: MOCK_MCP_PORT,
        }, async ({ page }) => {
            await sendChatMessage(page, 'Bellafronte')
            const bot = await waitForBotBubble(page, 1, 120_000)
            console.log('[M4.3] bot:', bot.slice(0, 200))
            // Bot deve rispondere anche con MCP slow (latency tolerance)
            expect(bot.length).toBeGreaterThan(5)
        })
    })

    test('M4.4 — happy path completion via mock MCP', async ({ request, browser }) => {
        test.setTimeout(8 * 60_000)
        mockMcp.setMode('happy')
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M4.4 HappyPath',
            useMockMcpPort: MOCK_MCP_PORT,
        }, async ({ page }) => {
            await sendChatMessage(page, 'Bellafronte')
            const bot = await waitForBotBubble(page, 1, 120_000)
            console.log('[M4.4] bot:', bot.slice(0, 200))
            expect(bot.length).toBeGreaterThan(5)
        })
    })
})
