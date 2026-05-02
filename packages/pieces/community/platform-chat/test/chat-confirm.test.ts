import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformChatAuth: { type: 'NONE' },
}));

import { chatConfirmAction } from '../src/lib/actions/chat-confirm';

describe('@platform/chat · chat-confirm action (E11)', () => {
  it('emits chat.confirm envelope tagged with the pre_submit_confirmation barrier', async () => {
    const createWaitpoint = vi.fn(async () => ({
      id: 'wp-confirm',
      resumeUrl: 'http://localhost/resume/wp-confirm',
      buildResumeUrl: () => 'http://localhost/resume/wp-confirm',
    }));
    const waitForWaitpoint = vi.fn();
    const result = await chatConfirmAction.run({
      auth: undefined,
      executionType: 'BEGIN',
      run: { createWaitpoint, waitForWaitpoint },
      propsValue: {
        summary: 'Estingui rapporto R-123 di Mario Rossi al 2026-05-30',
        confirmLabel: 'Estingui',
        rejectLabel: 'Annulla',
        fieldName: 'submissionConfirmed',
      },
    } as Parameters<typeof chatConfirmAction.run>[0]);

    expect(result.action).toBe('chat.confirm');
    expect(result.waitpointId).toBe('wp-confirm');
    expect(createWaitpoint).toHaveBeenCalledOnce();
    expect(waitForWaitpoint).toHaveBeenCalledWith('wp-confirm');
    expect(result.barrierName).toBe('pre_submit_confirmation');
    expect(result.summary).toContain('R-123');
    expect(result.confirmLabel).toBe('Estingui');
    expect(result.rejectLabel).toBe('Annulla');
    expect(result.outputField).toBe('submissionConfirmed');
    expect(typeof result.issuedAt).toBe('string');
  });

  it('preserves the pre_submit_confirmation barrier even when caller overrides defaults', async () => {
    const createWaitpoint = vi.fn(async () => ({
      id: 'wp-confirm-2',
      resumeUrl: 'http://localhost/resume/wp-confirm-2',
      buildResumeUrl: () => 'http://localhost/resume/wp-confirm-2',
    }));
    const result = await chatConfirmAction.run({
      auth: undefined,
      executionType: 'BEGIN',
      run: { createWaitpoint, waitForWaitpoint: vi.fn() },
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

  it('extracts resumed confirmation and marks the barrier when approved', async () => {
    const result = await chatConfirmAction.run({
      auth: undefined,
      executionType: 'RESUME',
      resumePayload: {
        body: { confirmationGiven: true },
        queryParams: {},
      },
      propsValue: {
        summary: 'Confirm',
        barrierName: 'pre_submit_confirmation',
        fieldName: 'confirmationGiven',
      },
    } as Parameters<typeof chatConfirmAction.run>[0]);

    expect(result.action).toBe('chat.confirm.completed');
    expect(result.confirmationGiven).toBe(true);
    expect(result.barriersReached).toEqual(['pre_submit_confirmation']);
  });

  it('extracts rejection from query action', async () => {
    const result = await chatConfirmAction.run({
      auth: undefined,
      executionType: 'RESUME',
      resumePayload: {
        body: {},
        queryParams: { action: 'cancel' },
      },
      propsValue: {
        summary: 'Confirm',
        fieldName: 'confirmationGiven',
      },
    } as Parameters<typeof chatConfirmAction.run>[0]);

    expect(result.confirmationGiven).toBe(false);
    expect(result.barriersReached).toEqual([]);
  });
});
