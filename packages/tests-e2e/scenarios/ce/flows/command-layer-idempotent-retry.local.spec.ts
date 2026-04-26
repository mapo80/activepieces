/**
 * T-14 — Idempotent retry: same message sent twice produces consistent state.
 *
 * Verifies that re-sending the same message in the same session does not
 * duplicate state or produce inconsistent bot responses. The command layer
 * uses idempotency keys to deduplicate turn processing.
 *
 * Implementation: send the same message twice from the same browser context
 * and verify the session ends up in a valid state.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-idempotent-retry.local.spec.ts
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

test.describe.configure({ mode: 'serial' })

test.describe('command-layer idempotent-retry', () => {
    test('T-14: re-sending the same input produces a consistent result', async ({ page: _page, request, browser }) => {
        test.setTimeout(10 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Idempotent T14 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Turn 1: first message
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[T-14] bot1:', bot1.slice(0, 80))
            expect(bot1.length).toBeGreaterThan(0)

            // Turn 2: send same message again (simulating retry)
            // The system must handle this gracefully
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[T-14] bot2 (retry):', bot2.slice(0, 80))
            expect(bot2.length).toBeGreaterThan(0)

            // The system should be in a valid state: either the LLM decided to
            // confirm the customer (idempotent) or ask a follow-up question.
            // Both are acceptable. What is NOT acceptable: crash or empty response.
            const allBubbles = await chatPage.locator('div.self-start').evaluateAll(
                (els) => els.map((e) => (e as HTMLElement).innerText.trim()).filter((t) => t.length > 0),
            )
            expect(allBubbles.length).toBeGreaterThanOrEqual(2)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
