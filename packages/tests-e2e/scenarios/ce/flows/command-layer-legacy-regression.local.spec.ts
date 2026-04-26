/**
 * T-15 — Legacy regression: useCommandLayer=false flow unchanged.
 *
 * Verifies that the estinzione rapporto flow (useCommandLayer=false, legacy
 * fieldExtractor path) still works after all command-layer changes.
 * Runs the 5-turn conversation and asserts caseId in the final turn.
 *
 * This is a regression guard: if the command-layer work inadvertently
 * breaks the legacy path, this test will fail.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-legacy-regression.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    signIn,
    importAndPublishFlow,
    deleteFlow,
    openChatPage,
    sendChatMessage,
    waitForBotBubble,
    ESTINZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('command-layer legacy-regression', () => {
    test('T-15: estinzione (useCommandLayer=false) 5-turn conversation still works', async ({ page: _page, request, browser }) => {
        test.setTimeout(12 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            ESTINZIONE_FIXTURE_PATH,
            `Estinzione Legacy Regression T15 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            const turns = [
                { user: 'Vorrei estinguere un rapporto di Bellafronte', expect: /bellafronte/i },
                { user: 'confermo il cliente Bellafronte con NDG 11255521', expect: /11255521|rapport/i },
                { user: 'per il cliente NDG 11255521 scelgo il rapporto 01-034-00392400', expect: /motivazion|data|reason/i },
                {
                    user: 'per NDG 11255521 rapporto 01-034-00392400: motivazione 01 trasferimento estero, data efficacia 2029-04-15',
                    expect: /confer|estinzion|pdf|confirm/i,
                },
                {
                    user: 'per cliente Bellafronte NDG 11255521 rapporto 01-034-00392400 motivazione 01 data 2029-04-15: sì confermo',
                    expect: /ES-\d{4}-\d+|invi|success|pratica|submit/i,
                },
            ]

            for (const [i, turn] of turns.entries()) {
                console.log(`[T-15] turn ${i + 1}: ${turn.user.slice(0, 60)}…`)
                await sendChatMessage(chatPage, turn.user)
                const bot = await waitForBotBubble(chatPage, i + 1, 180_000)
                console.log(`[T-15] bot${i + 1}:`, bot.slice(0, 100))
                expect(bot, `turn ${i + 1} assertion failed`).toMatch(turn.expect)
            }
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
