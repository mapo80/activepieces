/**
 * Conversation replay harness for Flow Copilot end-to-end tests.
 *
 * After the Copilot generates an INTERACTIVE_FLOW action from a functional
 * brief, we need to prove the flow is actually runnable: publish it behind
 * a `forms/chat_submission` trigger and drive a scripted conversation via
 * the public /chats/:flowId UI.
 *
 * This mirrors the ad-hoc pattern in estinzione-chat.local.spec.ts but
 * exposes it as a reusable helper so multiple domain tests can share the
 * same driver.
 */

import { APIRequestContext, BrowserContext, Page, expect } from '@playwright/test';

const AP_API = process.env.AP_API_URL ?? 'http://localhost:3000/api';
const CHAT_BASE_URL = process.env.CHAT_BASE_URL ?? 'http://localhost:4200';
const FORMS_PIECE_NAME = '@activepieces/piece-forms';
const FORMS_CHAT_TRIGGER_NAME = 'chat_submission';

export type ConversationStep = {
  kind: 'text';
  user: string;
  expectBotPattern?: RegExp;
};

export type ConversationTurn = {
  user: string;
  bot: string;
  passed: boolean;
  expectedPattern?: string;
};

export type ConversationResult = {
  ok: boolean;
  turns: ConversationTurn[];
  finalBotText?: string;
  failedAt?: number;
  reason?: string;
};

async function publishFlowAsChat(params: {
  request: APIRequestContext;
  token: string;
  flowId: string;
  displayName: string;
}): Promise<void> {
  const { request, token, flowId, displayName } = params;

  const flowRes = await request.get(`${AP_API}/v1/flows/${flowId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(flowRes.status(), `GET flow ${flowId} failed`).toBe(200);
  const flow = (await flowRes.json()) as {
    version: { trigger: FlowNode };
  };

  const interactiveFlowAction = findInteractiveFlowAction(flow.version.trigger);
  if (!interactiveFlowAction) {
    throw new Error(
      `flow ${flowId} has no INTERACTIVE_FLOW action — cannot publish as chat`,
    );
  }

  const formsVersion = await getPieceVersion(request, token, FORMS_PIECE_NAME);
  const now = new Date().toISOString();

  const chatTrigger: Record<string, unknown> = {
    name: 'trigger',
    displayName: 'Chat UI',
    type: 'PIECE_TRIGGER',
    valid: true,
    lastUpdatedDate: now,
    settings: {
      pieceName: FORMS_PIECE_NAME,
      pieceVersion: formsVersion,
      triggerName: FORMS_CHAT_TRIGGER_NAME,
      input: {
        botName: displayName,
      },
      propertySettings: {},
    },
    nextAction: injectLastUpdatedDate(
      interactiveFlowAction as Record<string, unknown>,
      now,
    ),
  };

  const importRes = await request.post(`${AP_API}/v1/flows/${flowId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: 'IMPORT_FLOW',
      request: {
        displayName,
        trigger: chatTrigger,
        schemaVersion: '20',
        notes: null,
      },
    },
  });
  expect(importRes.status(), `IMPORT_FLOW failed: ${await importRes.text()}`).toBe(200);

  const publishRes = await request.post(`${AP_API}/v1/flows/${flowId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'LOCK_AND_PUBLISH', request: {} },
  });
  expect(publishRes.status(), `LOCK_AND_PUBLISH failed`).toBe(200);
}

async function simulateConversation(params: {
  browserContext: BrowserContext;
  flowId: string;
  script: ConversationStep[];
  timeoutPerStepMs?: number;
}): Promise<ConversationResult> {
  const timeout = params.timeoutPerStepMs ?? 180_000;
  const chatPage = await params.browserContext.newPage();
  try {
    await chatPage.goto(`${CHAT_BASE_URL}/chats/${params.flowId}`);
    await chatPage.waitForLoadState('networkidle', { timeout: 30_000 });

    const turns: ConversationTurn[] = [];
    for (const [index, step] of params.script.entries()) {
      if (step.kind !== 'text') continue;
      const turnNum = index + 1;
      await sendChatMessage(chatPage, step.user);
      let bot = '';
      try {
        bot = await waitForNextBotBubble(chatPage, turnNum, timeout);
      } catch (err) {
        turns.push({
          user: step.user,
          bot: '',
          passed: false,
          expectedPattern: step.expectBotPattern?.source,
        });
        return {
          ok: false,
          turns,
          failedAt: index,
          reason: `timeout at turn ${turnNum}: ${(err as Error).message}`,
        };
      }
      const passed = step.expectBotPattern
        ? step.expectBotPattern.test(bot)
        : true;
      turns.push({
        user: step.user,
        bot,
        passed,
        expectedPattern: step.expectBotPattern?.source,
      });
      if (!passed) {
        return {
          ok: false,
          turns,
          failedAt: index,
          reason: `turn ${turnNum}: bot text did not match /${step.expectBotPattern?.source}/`,
        };
      }
    }

    return {
      ok: true,
      turns,
      finalBotText: turns[turns.length - 1]?.bot,
    };
  } finally {
    await chatPage.close().catch(() => undefined);
  }
}

async function sendChatMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator(
    'textarea[placeholder="Type your message here..."]',
  );
  await textarea.waitFor({ state: 'visible', timeout: 30_000 });
  await textarea.click();
  await textarea.fill(text);
  await textarea.press('Enter');
}

async function waitForNextBotBubble(
  page: Page,
  expectedBotCount: number,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bubbles = await page
      .locator('div.self-start')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).innerText.trim()),
      );
    const nonEmpty = bubbles.filter((t) => t.length > 0);
    if (nonEmpty.length >= expectedBotCount) {
      return nonEmpty[expectedBotCount - 1];
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for bot bubble #${expectedBotCount}`,
  );
}

async function getPieceVersion(
  request: APIRequestContext,
  token: string,
  pieceName: string,
): Promise<string> {
  const res = await request.get(
    `${AP_API}/v1/pieces/${encodeURIComponent(pieceName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json()) as { version: string };
  return body.version;
}

type FlowNode = {
  type?: string;
  nextAction?: FlowNode;
  [k: string]: unknown;
};

function findInteractiveFlowAction(node: FlowNode | undefined): FlowNode | undefined {
  if (!node) return undefined;
  if (node.type === 'INTERACTIVE_FLOW') return node;
  if (node.nextAction) return findInteractiveFlowAction(node.nextAction);
  return undefined;
}

function injectLastUpdatedDate(
  node: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };
  if (
    'type' in out &&
    'name' in out &&
    'displayName' in out &&
    !('lastUpdatedDate' in out)
  ) {
    out.lastUpdatedDate = now;
  }
  if (out.nextAction && typeof out.nextAction === 'object') {
    out.nextAction = injectLastUpdatedDate(
      out.nextAction as Record<string, unknown>,
      now,
    );
  }
  return out;
}

export const conversationHarness = {
  publishFlowAsChat,
  simulateConversation,
};
