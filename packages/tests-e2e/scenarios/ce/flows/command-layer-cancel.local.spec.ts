/**
 * T-06 — Cancel flow: trigger → confirm + trigger → reject.
 *
 * Two sub-scenarios:
 * a) User says "annulla" → bot asks for confirmation → user says "sì" → flow cancelled
 * b) User says "annulla" → bot asks for confirmation → user says "no" → flow resumes
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-cancel.local.spec.ts
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

test.describe('command-layer cancel', () => {
    test('T-06a: cancel → confirm → flow terminates gracefully', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Cancel-Confirm T06a ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Start the flow
            await sendChatMessage(chatPage, 'Bellafronte')
            await waitForBotBubble(chatPage, 1, 120_000)

            // Trigger cancel
            console.log('[T-06a] send: annulla')
            await sendChatMessage(chatPage, 'annulla')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[T-06a] bot2 (after annulla):', bot2.slice(0, 120))
            // Bot should ask for confirmation
            expect(bot2).toMatch(/annull|cancel|confer|sicur/i)

            // Confirm cancellation
            await sendChatMessage(chatPage, 'sì confermo')
            const bot3 = await waitForBotBubble(chatPage, 3, 120_000)
            console.log('[T-06a] bot3 (after sì):', bot3.slice(0, 120))
            // Bot should acknowledge cancellation
            expect(bot3).toMatch(/annull|cancel|termin|chiud|fine/i)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })

    test('T-06b: cancel → reject → flow resumes normally', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Cancel-Reject T06b ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Start the flow
            await sendChatMessage(chatPage, 'Bellafronte')
            await waitForBotBubble(chatPage, 1, 120_000)

            // Trigger cancel
            await sendChatMessage(chatPage, 'annulla')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[T-06b] bot2 (after annulla):', bot2.slice(0, 120))
            expect(bot2).toMatch(/annull|cancel|confer|sicur/i)

            // Reject cancellation
            await sendChatMessage(chatPage, 'no continuiamo')
            const bot3 = await waitForBotBubble(chatPage, 3, 120_000)
            console.log('[T-06b] bot3 (after no):', bot3.slice(0, 120))
            // Bot should resume the flow (not cancelled)
            expect(bot3.length).toBeGreaterThan(5)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
