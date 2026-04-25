import { test, expect } from '@playwright/test';
import {
    expectActionTrace,
    expectBotMessage,
    openChatForFixture,
    sendUserMessage,
    setupMockMcp,
} from '../../../fixtures/chat-runtime-helpers';

void [expect, expectActionTrace, expectBotMessage, openChatForFixture, sendUserMessage, setupMockMcp];

test.describe.skip('command-layer topic-change', () => {
    test.beforeEach(async ({ page: _ }) => {
        await setupMockMcp({ mode: 'happy' });
    });

    test.skip('TODO T-09: TOPIC_CHANGED clears downstream state', async ({ page: _ }) => {
        // outline: see docs/interactive-flow/closure-plan.md Appendix B T-09
    });
});
