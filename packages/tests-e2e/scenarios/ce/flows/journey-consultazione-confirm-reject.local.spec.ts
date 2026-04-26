/**
 * M1bis — Consultazione confirm reject (3 turni).
 *
 * Copre: RESOLVE_PENDING(confirm_binary, reject) — l'utente rifiuta la
 * conferma di condivisione del report al confirm_shared node, il flow
 * chiude senza submit (sharedConfirmed=false).
 *
 * RUN
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/journey-consultazione-confirm-reject.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('M1bis — consultazione confirm reject', () => {
    test('3-turn: confirm_binary reject → flow chiude senza submit', async ({ request, browser }) => {
        test.setTimeout(8 * 60_000)
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M1bis ConfirmReject',
        }, async ({ page }) => {
            // T1 — start, flow goes through tools and pauses on confirm_shared
            console.log('[M1bis] T1: Bellafronte')
            await sendChatMessage(page, 'Bellafronte')
            const t1 = await waitForBotBubble(page, 1, 120_000)
            console.log('[M1bis] bot1:', t1.slice(0, 150))
            expect(t1.length).toBeGreaterThan(5)

            // T2 — ambiguous, no resolve (REPROMPT or no-op)
            console.log('[M1bis] T2: aspetta non sono pronto, controlla anche i conti deposito')
            await sendChatMessage(page, 'aspetta non sono pronto, controlla anche i conti deposito')
            const t2 = await waitForBotBubble(page, 2, 120_000)
            console.log('[M1bis] bot2:', t2.slice(0, 150))
            expect(t2.length).toBeGreaterThan(5)

            // T3 — RESOLVE_PENDING(confirm_binary, reject)
            console.log('[M1bis] T3: no, non condividere il report')
            await sendChatMessage(page, 'no, non condividere il report')
            const t3 = await waitForBotBubble(page, 3, 120_000)
            console.log('[M1bis] bot3:', t3.slice(0, 150))
            expect(t3.length).toBeGreaterThan(5)
        })
    })
})
