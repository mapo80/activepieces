import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformChatAuth: { type: 'NONE' },
}));

import { chatAskAction } from '../src/lib/actions/chat-ask';

describe('@platform/chat · chat-ask action (E11)', () => {
  it('emits chat.ask envelope with promptText, outputField, component and timeout', async () => {
    const createWaitpoint = vi.fn(async () => ({
      id: 'wp-1',
      resumeUrl: 'http://localhost/resume/wp-1',
      buildResumeUrl: () => 'http://localhost/resume/wp-1',
    }));
    const waitForWaitpoint = vi.fn();
    const result = await chatAskAction.run({
      auth: undefined,
      executionType: 'BEGIN',
      run: { createWaitpoint, waitForWaitpoint },
      propsValue: {
        promptText: 'Quale rapporto vuoi estinguere?',
        fieldName: 'relationshipId',
        component: 'choice-list',
        allowedValues: ['R-123', 'R-456'],
        timeoutSeconds: 300,
      },
    } as Parameters<typeof chatAskAction.run>[0]);

    expect(result.action).toBe('chat.ask');
    expect(result.waitpointId).toBe('wp-1');
    expect(createWaitpoint).toHaveBeenCalledOnce();
    expect(waitForWaitpoint).toHaveBeenCalledWith('wp-1');
    expect(result.promptText).toBe('Quale rapporto vuoi estinguere?');
    expect(result.outputField).toBe('relationshipId');
    expect(result.component).toBe('choice-list');
    expect(result.allowedValues).toEqual(['R-123', 'R-456']);
    expect(result.timeoutSeconds).toBe(300);
    expect(typeof result.issuedAt).toBe('string');
  });

  it('defaults component to text-input, allowedValues to [], timeout to 600 when omitted', async () => {
    const createWaitpoint = vi.fn(async () => ({
      id: 'wp-2',
      resumeUrl: 'http://localhost/resume/wp-2',
      buildResumeUrl: () => 'http://localhost/resume/wp-2',
    }));
    const result = await chatAskAction.run({
      auth: undefined,
      executionType: 'BEGIN',
      run: { createWaitpoint, waitForWaitpoint: vi.fn() },
      propsValue: {
        promptText: 'Why do you want to close?',
        fieldName: 'closureReasonText',
      },
    } as Parameters<typeof chatAskAction.run>[0]);

    expect(result.component).toBe('text-input');
    expect(result.allowedValues).toEqual([]);
    expect(result.timeoutSeconds).toBe(600);
    expect(result.outputField).toBe('closureReasonText');
  });

  it('extracts resumed answer into the configured output field', async () => {
    const result = await chatAskAction.run({
      auth: undefined,
      executionType: 'RESUME',
      resumePayload: {
        body: { relationshipId: 'R-123' },
        queryParams: {},
      },
      propsValue: {
        promptText: 'Quale rapporto vuoi estinguere?',
        fieldName: 'relationshipId',
      },
    } as Parameters<typeof chatAskAction.run>[0]);

    expect(result.action).toBe('chat.ask.completed');
    expect(result.outputField).toBe('relationshipId');
    expect(result.relationshipId).toBe('R-123');
    expect(result.value).toBe('R-123');
  });
});
