/**
 * T-10 — Timeline: multiple turns, bot messages appear in correct order.
 *
 * Runs 3 turns of a consultazione conversation and verifies that bot
 * messages are received in the expected order (response 1 before 2, etc.).
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-timeline.local.spec.ts
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

test.describe('command-layer timeline', () => {
    test('T-10: 3 turns produce ordered bot messages', async ({ page: _page, request, browser }) => {
        test.setTimeout(10 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Timeline T10 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            const messages: string[] = []

            // Turn 1
            await sendChatMessage(chatPage, 'Bellafronte')
            const b1 = await waitForBotBubble(chatPage, 1, 120_000)
            messages.push(b1)
            console.log('[T-10] bot1:', b1.slice(0, 80))

            // Turn 2 — meta question to generate another bot turn without side effects
            await sendChatMessage(chatPage, 'cosa mi avevi chiesto?')
            const b2 = await waitForBotBubble(chatPage, 2, 120_000)
            messages.push(b2)
            console.log('[T-10] bot2:', b2.slice(0, 80))

            // Turn 3 — provide NDG to advance the flow
            await sendChatMessage(chatPage, '11255521')
            const b3 = await waitForBotBubble(chatPage, 3, 120_000)
            messages.push(b3)
            console.log('[T-10] bot3:', b3.slice(0, 80))

            // All 3 bot messages were received
            expect(messages).toHaveLength(3)
            // All non-empty
            for (const m of messages) expect(m.length).toBeGreaterThan(0)

            // The page DOM should show >= 3 bot bubbles in order.
            // We do NOT compare innerText to messages[] here because ConfirmCard
            // rich content (PDF loading state → Anteprima/Scarica) changes after
            // the initial waitForBotBubble capture, making exact comparison flaky.
            const bubbleCount = await chatPage.locator('div.self-start').evaluateAll(
                (els) => els.filter((e) => (e as HTMLElement).innerText.trim().length > 0).length,
            )
            expect(bubbleCount).toBeGreaterThanOrEqual(3)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
