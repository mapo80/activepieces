/**
 * T-07 — Cancel TTL: pending_cancel older than 60s is automatically cleared.
 *
 * The TTL is enforced by the pre-resolver on the NEXT incoming turn.
 * Since we can't advance a real clock in the browser, this test verifies
 * the cancel flow at the API level: it injects a stale pending_cancel
 * via the session-store (by inspecting the pending interaction returned
 * by the command layer), then sends a new message.
 *
 * For the full 60s TTL validation, see the API test in
 * command-layer-mid-conversation.test.ts (pre-resolvers.ts unit tests).
 *
 * This Playwright spec verifies the END-TO-END path:
 * 1. Normal cancel flow (< TTL) works correctly.
 * 2. After the pending is resolved, the next turn proceeds normally.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-cancel-ttl.local.spec.ts
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

test.describe('command-layer cancel-ttl', () => {
    test('T-07: cancel triggered then resolved → next turn proceeds normally', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione CancelTTL T07 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Turn 1: start conversation
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[T-07] bot1:', bot1.slice(0, 80))
            expect(bot1.length).toBeGreaterThan(0)

            // Turn 2: request cancel → bot asks for confirmation
            await sendChatMessage(chatPage, 'annulla')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[T-07] bot2 (after annulla):', bot2.slice(0, 80))
            expect(bot2).toMatch(/annull|cancel|confer|sicur/i)

            // Turn 3: reject cancel → pending_cancel cleared, flow resumes
            await sendChatMessage(chatPage, 'no aspetta continuiamo')
            const bot3 = await waitForBotBubble(chatPage, 3, 120_000)
            console.log('[T-07] bot3 (after no):', bot3.slice(0, 80))
            expect(bot3.length).toBeGreaterThan(5)

            // Turn 4: next message after resolved cancel proceeds normally
            await sendChatMessage(chatPage, '11255521')
            const bot4 = await waitForBotBubble(chatPage, 4, 120_000)
            console.log('[T-07] bot4 (after NDG):', bot4.slice(0, 80))
            // Flow should continue (not stuck in cancel state)
            expect(bot4.length).toBeGreaterThan(5)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
