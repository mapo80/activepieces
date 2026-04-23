import { describe, expect, it, beforeEach } from 'vitest';

import { useCopilotStore } from '../copilot-store';

beforeEach(() => {
  useCopilotStore.getState().reset();
});

describe('useCopilotStore', () => {
  it('open/close/toggle flip the panel state', () => {
    expect(useCopilotStore.getState().isOpen).toBe(false);
    useCopilotStore.getState().open();
    expect(useCopilotStore.getState().isOpen).toBe(true);
    useCopilotStore.getState().close();
    expect(useCopilotStore.getState().isOpen).toBe(false);
    useCopilotStore.getState().toggle();
    expect(useCopilotStore.getState().isOpen).toBe(true);
  });

  it('startSession resets messages and sets scope + flow id', () => {
    useCopilotStore.getState().startSession({
      sessionId: 's1',
      scope: 'INTERACTIVE_FLOW',
      flowId: 'f1',
    });
    const s = useCopilotStore.getState();
    expect(s.sessionId).toBe('s1');
    expect(s.scope).toBe('INTERACTIVE_FLOW');
    expect(s.flowId).toBe('f1');
    expect(s.messages).toEqual([]);
    expect(s.hasManualEditSinceSession).toBe(false);
  });

  it('appendUserMessage + startAssistantMessage append in order', () => {
    const store = useCopilotStore.getState();
    store.appendUserMessage('hi');
    const aid = store.startAssistantMessage();
    const messages = useCopilotStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].kind).toBe('user');
    expect(messages[1].kind).toBe('assistant');
    expect(messages[1].id).toBe(aid);
  });

  it('tool-call lifecycle: start → markFlowUpdated → end', () => {
    const store = useCopilotStore.getState();
    const aid = store.startAssistantMessage();
    store.startToolCall({
      assistantId: aid,
      toolCallId: 't1',
      name: 'add_state_field',
      args: { name: 'x' },
    });
    store.markFlowUpdated('t1');
    store.endToolCall({ toolCallId: 't1', result: { applied: true } });
    const asst = useCopilotStore.getState().messages[0];
    if (asst.kind === 'assistant') {
      expect(asst.toolCalls).toHaveLength(1);
      expect(asst.toolCalls[0].status).toBe('success');
      expect(asst.toolCalls[0].flowUpdatedPreview).toBe(true);
    }
  });

  it('setSummary stops streaming and attaches summary', () => {
    const store = useCopilotStore.getState();
    const aid = store.startAssistantMessage();
    store.setSummary({
      assistantId: aid,
      text: 'done',
      appliedCount: 2,
      questions: ['q1'],
    });
    const asst = useCopilotStore.getState().messages[0];
    if (asst.kind === 'assistant') {
      expect(asst.isStreaming).toBe(false);
      expect(asst.summary).toEqual({
        text: 'done',
        appliedCount: 2,
        questions: ['q1'],
      });
    }
  });

  it('manual edit flag can be set and cleared', () => {
    useCopilotStore.getState().markManualEdit();
    expect(useCopilotStore.getState().hasManualEditSinceSession).toBe(true);
    useCopilotStore.getState().clearManualEdit();
    expect(useCopilotStore.getState().hasManualEditSinceSession).toBe(false);
  });
});
