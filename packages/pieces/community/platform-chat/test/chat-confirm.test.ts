import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformChatAuth: { type: 'NONE' },
}));

import { chatConfirmAction } from '../src/lib/actions/chat-confirm';

describe('@platform/chat · chat-confirm action (E11)', () => {
  it('emits chat.confirm envelope tagged with the pre_submit_confirmation barrier', async () => {
    const result = await chatConfirmAction.run({
      auth: undefined,
      propsValue: {
        summary: 'Estingui rapporto R-123 di Mario Rossi al 2026-05-30',
        confirmLabel: 'Estingui',
        rejectLabel: 'Annulla',
        fieldName: 'submissionConfirmed',
      },
    } as Parameters<typeof chatConfirmAction.run>[0]);

    expect(result.action).toBe('chat.confirm');
    expect(result.barrierName).toBe('pre_submit_confirmation');
    expect(result.summary).toContain('R-123');
    expect(result.confirmLabel).toBe('Estingui');
    expect(result.rejectLabel).toBe('Annulla');
    expect(result.outputField).toBe('submissionConfirmed');
    expect(typeof result.issuedAt).toBe('string');
  });

  it('preserves the pre_submit_confirmation barrier even when caller overrides defaults', async () => {
    const result = await chatConfirmAction.run({
      auth: undefined,
      propsValue: {
        summary: 'Confirm',
        barrierName: 'pre_submit_confirmation',
      },
    } as Parameters<typeof chatConfirmAction.run>[0]);

    expect(result.barrierName).toBe('pre_submit_confirmation');
    expect(result.confirmLabel).toBe('Confirm');
    expect(result.rejectLabel).toBe('Cancel');
    expect(result.outputField).toBe('confirmed');
  });
});
