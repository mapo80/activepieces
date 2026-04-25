import { test, expect } from '@playwright/test';
import {
    expectActionTrace,
    expectBotMessage,
    openChatForFixture,
    sendUserMessage,
    setupMockMcp,
} from '../../../fixtures/chat-runtime-helpers';

void [expect, expectActionTrace, expectBotMessage, openChatForFixture, sendUserMessage, setupMockMcp];

test.describe.skip('command-layer catalog-failure', () => {
    test.beforeEach(async ({ page: _ }) => {
        await setupMockMcp({ mode: 'happy' });
    });

    test.skip('TODO T-13: CATALOG_PREEXEC_FAILED on slow MCP', async ({ page: _ }) => {
        // outline: see docs/interactive-flow/closure-plan.md Appendix B T-13
    });
});
