import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformWorkflowAuth: { type: 'NONE' },
}));

import { waitEventAction } from '../src/lib/actions/wait-event';
import { ExecutionType } from '@activepieces/shared';

describe('@platform/workflow · wait-event action (E11)', () => {
  it('opens an AP webhook waitpoint with eventName and outputFields', async () => {
    const createWaitpoint = vi.fn().mockResolvedValue({
      id: 'wp-1',
      resumeUrl: 'https://ap.local/waitpoints/wp-1',
    });
    const waitForWaitpoint = vi.fn();

    const result = await waitEventAction.run({
      auth: undefined,
      run: { createWaitpoint, waitForWaitpoint },
      propsValue: {
        eventName: 'closure.callback',
        outputFields: ['closureReceiptId', 'finalStatus'],
        component: 'banking.callback',
        promptHint: 'Attendo il callback operativo.',
        timeoutSeconds: 1800,
      },
    } as Parameters<typeof waitEventAction.run>[0]);

    expect(result.action).toBe('workflow.waitEvent');
    expect(result.waitpointId).toBe('wp-1');
    expect(result.resumeUrl).toBe('https://ap.local/waitpoints/wp-1');
    expect(result.eventName).toBe('closure.callback');
    expect(result.outputFields).toEqual(['closureReceiptId', 'finalStatus']);
    expect(result.component).toBe('banking.callback');
    expect(result.promptText).toBe('Attendo il callback operativo.');
    expect(result.timeoutSeconds).toBe(1800);
    expect(typeof result.issuedAt).toBe('string');
    expect(createWaitpoint).toHaveBeenCalledWith({
      type: 'WEBHOOK',
      responseToSend: {
        status: 200,
        body: {
          action: 'workflow.waitEvent',
          eventName: 'closure.callback',
          outputFields: ['closureReceiptId', 'finalStatus'],
          component: 'banking.callback',
          promptText: 'Attendo il callback operativo.',
          summary: 'Attendo il callback operativo.',
        },
      },
    });
    expect(waitForWaitpoint).toHaveBeenCalledWith('wp-1');
  });

  it('defaults timeout to 600 and outputFields to [] when caller omits them', async () => {
    const createWaitpoint = vi.fn().mockResolvedValue({
      id: 'wp-2',
      resumeUrl: 'https://ap.local/waitpoints/wp-2',
    });
    const waitForWaitpoint = vi.fn();

    const result = await waitEventAction.run({
      auth: undefined,
      run: { createWaitpoint, waitForWaitpoint },
      propsValue: {
        eventName: 'evt',
        outputFields: [],
      },
    } as Parameters<typeof waitEventAction.run>[0]);

    expect(result.timeoutSeconds).toBe(600);
    expect(result.outputFields).toEqual([]);
    expect(result.component).toBe('text-input');
    expect(waitForWaitpoint).toHaveBeenCalledWith('wp-2');
  });

  it('maps resume payload values into declared output fields', async () => {
    const result = await waitEventAction.run({
      auth: undefined,
      executionType: ExecutionType.RESUME,
      resumePayload: {
        body: {
          payload: {
            relationshipId: 'REL-9',
            turnId: 'turn-resume-1',
          },
        },
      },
      propsValue: {
        eventName: 'relationship.corrected',
        outputFields: ['relationshipId'],
        platformNextStep: 'verify_relationship',
      },
    } as Parameters<typeof waitEventAction.run>[0]);

    expect(result.action).toBe('workflow.waitEvent.completed');
    expect(result.relationshipId).toBe('REL-9');
    expect(result.platformSourceTurnId).toBe('turn-resume-1');
    expect(result.platformNextStep).toBe('verify_relationship');
  });
});
