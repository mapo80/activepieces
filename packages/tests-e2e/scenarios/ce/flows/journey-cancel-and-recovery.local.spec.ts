/**
 * M3 — Cancel and recovery mega-journey (6 turni).
 *
 * Copre: REQUEST_CANCEL ×2, pending_cancel, RESOLVE_PENDING(reject) → resume,
 * RESOLVE_PENDING(accept) → terminate, ANSWER_INFO post-resume.
 *
 * RUN
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/journey-cancel-and-recovery.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('M3 — cancel and recovery journey', () => {
    test('6-turn: REQUEST_CANCEL accept+reject + resume', async ({ request, browser }) => {
        test.setTimeout(12 * 60_000)
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M3 CancelRecovery',
        }, async ({ page }) => {
            // T1 — start
            console.log('[M3] T1: Bellafronte')
            await sendChatMessage(page, 'Bellafronte')
            const t1 = await waitForBotBubble(page, 1, 120_000)
            console.log('[M3] bot1:', t1.slice(0, 150))
            expect(t1.length).toBeGreaterThan(5)

            // T2 — REQUEST_CANCEL
            console.log('[M3] T2: annulla')
            await sendChatMessage(page, 'annulla')
            const t2 = await waitForBotBubble(page, 2, 120_000)
            console.log('[M3] bot2:', t2.slice(0, 150))
            expect(t2).toMatch(/annull|cancel|confer|sicur/i)

            // T3 — RESOLVE_PENDING(reject) → resume
            console.log('[M3] T3: no continuiamo')
            await sendChatMessage(page, 'no continuiamo')
            const t3 = await waitForBotBubble(page, 3, 120_000)
            console.log('[M3] bot3:', t3.slice(0, 150))
            expect(t3.length).toBeGreaterThan(5)

            // T4 — verify resume works (ANSWER_INFO post-resume)
            console.log('[M3] T4: quanti rapporti ha?')
            await sendChatMessage(page, 'quanti rapporti ha?')
            const t4 = await waitForBotBubble(page, 4, 120_000)
            console.log('[M3] bot4:', t4.slice(0, 150))
            expect(t4.length).toBeGreaterThan(5)

            // T5 — REQUEST_CANCEL again
            console.log('[M3] T5: annulla tutto, ho cambiato idea')
            await sendChatMessage(page, 'annulla tutto, ho cambiato idea')
            const t5 = await waitForBotBubble(page, 5, 120_000)
            console.log('[M3] bot5:', t5.slice(0, 150))
            expect(t5).toMatch(/annull|cancel|confer|sicur/i)

            // T6 — RESOLVE_PENDING(accept) → terminate
            console.log('[M3] T6: sì confermo annulla')
            await sendChatMessage(page, 'sì confermo annulla')
            const t6 = await waitForBotBubble(page, 6, 120_000)
            console.log('[M3] bot6:', t6.slice(0, 150))
            expect(t6).toMatch(/annull|cancel|termin|chiud|fine|complet/i)
        })
    })
})
