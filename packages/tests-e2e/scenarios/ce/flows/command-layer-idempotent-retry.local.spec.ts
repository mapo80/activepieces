import { test, expect } from '@playwright/test';
import {
    expectActionTrace,
    expectBotMessage,
    openChatForFixture,
    sendUserMessage,
    setupMockMcp,
} from '../../../fixtures/chat-runtime-helpers';

void [expect, expectActionTrace, expectBotMessage, openChatForFixture, sendUserMessage, setupMockMcp];

test.describe.skip('command-layer idempotent-retry', () => {
    test.beforeEach(async ({ page: _ }) => {
        await setupMockMcp({ mode: 'happy' });
    });

    test.skip('TODO T-14: duplicate POST /interpret-turn returns same response', async ({ page: _ }) => {
        // outline: see docs/interactive-flow/closure-plan.md Appendix B T-14
    });
});
