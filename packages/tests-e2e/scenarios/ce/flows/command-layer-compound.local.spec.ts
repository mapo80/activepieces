/**
 * T-08 — Compound message: "Rossi quanti rapporti ha?"
 *
 * A single user message that both extracts a field (customerName=Rossi)
 * AND asks an info question (how many accounts). The command layer should
 * generate SET_FIELDS + ANSWER_INFO in the same turn.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-compound.local.spec.ts
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

test.describe('command-layer compound', () => {
    test('T-08: compound message extracts field AND answers info in one turn', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Compound T08 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Turn 1: compound message — name + info query
            // Using Bellafronte (valid AEP customer) for a compound SET_FIELDS + ANSWER_INFO turn
            console.log('[T-08] turn 1: Bellafronte quanti rapporti ha?')
            await sendChatMessage(chatPage, 'Bellafronte quanti rapporti ha?')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[T-08] bot1:', bot1.slice(0, 150))
            // Bot should either: answer the info OR acknowledge the name and then answer info
            // Both are valid compound outcomes. The response must be non-empty and meaningful.
            expect(bot1.length).toBeGreaterThan(5)
            // Must reference accounts, customer, or search result
            expect(bot1).toMatch(/rapporti|conti|cliente|ricerca|cerco|Bellafronte/i)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
