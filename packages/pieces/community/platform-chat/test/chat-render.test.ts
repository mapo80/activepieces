import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformChatAuth: { type: 'NONE' },
}));

import { chatRenderAction } from '../src/lib/actions/chat-render';

describe('@platform/chat · chat-render action', () => {
  it('emits chat.render envelope with required fields', async () => {
    const result = await chatRenderAction.run({
      auth: undefined,
      propsValue: {
        renderType: 'card',
        title: 'Closure summary',
        body: 'Are you sure you want to close account A-1?',
        sourceFields: ['accountId', 'reason'],
      },
    } as Parameters<typeof chatRenderAction.run>[0]);

    expect(result.action).toBe('chat.render');
    expect(result.renderType).toBe('card');
    expect(result.title).toBe('Closure summary');
    expect(result.body).toContain('A-1');
    expect(result.sourceFields).toEqual(['accountId', 'reason']);
    expect(typeof result.renderedAt).toBe('string');
  });

  it('falls back to null title and empty sourceFields when omitted', async () => {
    const result = await chatRenderAction.run({
      auth: undefined,
      propsValue: {
        renderType: 'text',
        body: 'plain message',
      },
    } as Parameters<typeof chatRenderAction.run>[0]);

    expect(result.title).toBeNull();
    expect(result.sourceFields).toEqual([]);
  });

  it('emits reasonCatalog render type for ambiguous closure reasons', async () => {
    const result = await chatRenderAction.run({
      auth: undefined,
      propsValue: {
        renderType: 'reasonCatalog',
        title: 'Motivazione non identificata',
        body: 'Seleziona o scrivi una motivazione tra quelle disponibili.',
      },
    } as Parameters<typeof chatRenderAction.run>[0]);

    expect(result.renderType).toBe('reasonCatalog');
    expect(result.title).toBe('Motivazione non identificata');
  });
});
