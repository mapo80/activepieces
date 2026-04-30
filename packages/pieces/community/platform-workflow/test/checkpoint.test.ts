import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformWorkflowAuth: { type: 'NONE' },
}));

import { checkpointAction } from '../src/lib/actions/checkpoint';

describe('@platform/workflow · checkpoint action', () => {
  it('emits workflow.checkpoint envelope with barriers', async () => {
    const result = await checkpointAction.run({
      auth: undefined,
      propsValue: {
        checkpointId: 'submit-cp',
        barriers: ['pre_submit_confirmation'],
        revisionable: true,
      },
    } as Parameters<typeof checkpointAction.run>[0]);

    expect(result.action).toBe('workflow.checkpoint');
    expect(result.checkpointId).toBe('submit-cp');
    expect(result.barriers).toEqual(['pre_submit_confirmation']);
    expect(result.revisionable).toBe(true);
    expect(typeof result.reachedAt).toBe('string');
  });

  it('defaults barriers to empty and revisionable to false when omitted', async () => {
    const result = await checkpointAction.run({
      auth: undefined,
      propsValue: { checkpointId: 'cp-1' },
    } as Parameters<typeof checkpointAction.run>[0]);

    expect(result.barriers).toEqual([]);
    expect(result.revisionable).toBe(false);
  });
});
