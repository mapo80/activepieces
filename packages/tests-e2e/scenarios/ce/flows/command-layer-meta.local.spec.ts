/**
 * DEV-03 status: Playwright spec marked as fixme.
 *
 * The scenario is functionally covered by the API-level integration tests
 * in `packages/server/api/test/integration/ce/ai/` (turn-interpreter,
 * publisher-integration, finalize-rollback, cross-flow, store-cas suites
 * — 140 tests as of post-DEV-04). The dev-stack live execution (real UI
 * + WS frames + DB query loop) is on-call territory:
 *
 *   1. Start bridge: `cd ../claude-code-openai-bridge && npm run dev`
 *   2. Set `AP_TEST_DATABASE_URL=postgresql://...` for `readDbTurnLog` /
 *      `readDbOutbox` helpers
 *   3. Run dev-stack with `AP_LLM_VIA_BRIDGE=true npm run dev`
 *   4. Remove `.fixme` from this file's describe + per-test, fill in the
 *      TODO body using helpers from `chat-runtime-helpers.ts`
 *   5. Run with `AP_EDITION=ce npx playwright test <this-file>`
 *
 * The DB helpers (readDbTurnLog/readDbOutbox) ARE implemented (DEV-03
 * commit) — they require a Postgres connection string + the `pg` package.
 */
import { test, expect } from '@playwright/test';
import {
    expectActionTrace,
    expectBotMessage,
    openChatForFixture,
    sendUserMessage,
    setupMockMcp,
} from '../../../fixtures/chat-runtime-helpers';

void [expect, expectActionTrace, expectBotMessage, openChatForFixture, sendUserMessage, setupMockMcp];

test.describe.fixme('command-layer meta', () => {
    test.beforeEach(async ({ page: _ }) => {
        await setupMockMcp({ mode: 'happy' });
    });

    test.fixme('TODO T-04: meta-questions during estinzione mid-flow', async ({ page: _ }) => {
        // outline: see docs/interactive-flow/closure-plan.md Appendix B T-04
    });
});
