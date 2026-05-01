import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformWorkflowAuth: { type: 'NONE' },
}));

import { waitEventAction } from '../src/lib/actions/wait-event';

describe('@platform/workflow · wait-event action (E11)', () => {
  it('emits workflow.waitEvent envelope with eventName and outputFields', async () => {
    const result = await waitEventAction.run({
      auth: undefined,
      propsValue: {
        eventName: 'closure.callback',
        outputFields: ['closureReceiptId', 'finalStatus'],
        timeoutSeconds: 1800,
      },
    } as Parameters<typeof waitEventAction.run>[0]);

    expect(result.action).toBe('workflow.waitEvent');
    expect(result.eventName).toBe('closure.callback');
    expect(result.outputFields).toEqual(['closureReceiptId', 'finalStatus']);
    expect(result.timeoutSeconds).toBe(1800);
    expect(typeof result.issuedAt).toBe('string');
  });

  it('defaults timeout to 600 and outputFields to [] when caller omits them', async () => {
    const result = await waitEventAction.run({
      auth: undefined,
      propsValue: {
        eventName: 'evt',
        outputFields: [],
      },
    } as Parameters<typeof waitEventAction.run>[0]);

    expect(result.timeoutSeconds).toBe(600);
    expect(result.outputFields).toEqual([]);
  });
});
