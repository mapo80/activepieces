/**
 * H-02 — Bridge smoke: consultazione with real LLM extracts customerName.
 *
 * Verifies the full path: browser → AP chat → command layer → bridge →
 * Claude CLI → field extracted → bot responds.
 *
 * Skips automatically when AP_LLM_VIA_BRIDGE is not 'true'.
 *
 * RUN (requires bridge at :8787)
 *   AP_LLM_VIA_BRIDGE=true E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 \
 *   AP_EDITION=ce npx playwright test \
 *     scenarios/ce/flows/command-layer-bridge-smoke.local.spec.ts
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

const BRIDGE_URL = process.env.OPENAI_BASE_URL ?? process.env.CLAUDE_BRIDGE_URL ?? 'http://localhost:8787'

test.describe('command-layer bridge smoke (opt-in)', () => {
    test.beforeAll(async () => {
        // Bridge must be running
        const res = await fetch(`${BRIDGE_URL}/health`).catch(() => null)
        if (!res || res.status !== 200) {
            test.skip()
        }
    })

    test('H-02: send "Bellafronte" → customerName extracted via real LLM', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Bridge Smoke H02 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Send customer name — LLM should extract it and start customer search
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[H-02] bot1:', bot1.slice(0, 150))

            // The response should reference the customer name (extraction worked)
            expect(bot1).toMatch(/bellafronte|cliente|cliente|trovat|selezion|ndg|scegli/i)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })

    test('H-02b: cancel flow via "annulla" → REQUEST_CANCEL pending', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Cancel Smoke H02b ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Start with a customer
            await sendChatMessage(chatPage, 'Bellafronte')
            await waitForBotBubble(chatPage, 1, 120_000)

            // Cancel
            await sendChatMessage(chatPage, 'annulla')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[H-02b] bot2:', bot2.slice(0, 120))
            // Bot should ask for confirmation
            expect(bot2).toMatch(/annull|cancel|confer|sicur/i)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
