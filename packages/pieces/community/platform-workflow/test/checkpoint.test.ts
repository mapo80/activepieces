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

  it('selects the matching canonical branch and exposes AP jump target', async () => {
    const result = await checkpointAction.run({
      auth: undefined,
      propsValue: {
        checkpointId: 'relationship-branch',
        bindingData: { relationshipOwnerMatched: 'false' },
        branches: [
          {
            condition: "relationshipOwnerMatched == 'true'",
            next: 'ask_date',
          },
          {
            condition: "relationshipOwnerMatched == 'false'",
            next: 'relationship_mismatch',
          },
          {
            default: true,
            next: 'manual_review',
          },
        ],
      },
    } as Parameters<typeof checkpointAction.run>[0]);

    expect(result.platformNextStep).toBe('relationship_mismatch');
    expect(result.selectedBranch).toBe(1);
    expect(result.branches).toEqual([
      { condition: "relationshipOwnerMatched == 'true'", default: false, next: 'ask_date' },
      { condition: "relationshipOwnerMatched == 'false'", default: false, next: 'relationship_mismatch' },
      { condition: undefined, default: true, next: 'manual_review' },
    ]);
  });

  it('supports provider-neutral numeric and presence branch conditions', async () => {
    const numeric = await checkpointAction.run({
      auth: undefined,
      propsValue: {
        checkpointId: 'customer-found-guard',
        bindingData: { customerSearchResultCount: 0, customerId: '' },
        branches: [
          {
            condition: 'customerSearchResultCount > 0',
            next: 'list_relationships',
          },
          {
            condition: 'missing(customerId)',
            next: 'customer_not_found',
          },
          {
            default: true,
            next: 'manual_review',
          },
        ],
      },
    } as Parameters<typeof checkpointAction.run>[0]);

    expect(numeric.platformNextStep).toBe('customer_not_found');
    expect(numeric.selectedBranch).toBe(1);

    const found = await checkpointAction.run({
      auth: undefined,
      propsValue: {
        checkpointId: 'customer-found-guard',
        bindingData: { customerSearchResultCount: '1', customerId: 'CUST-001' },
        branches: [
          {
            condition: 'customerSearchResultCount > 0',
            next: 'list_relationships',
          },
          {
            condition: 'missing(customerId)',
            next: 'customer_not_found',
          },
        ],
      },
    } as Parameters<typeof checkpointAction.run>[0]);

    expect(found.platformNextStep).toBe('list_relationships');
    expect(found.selectedBranch).toBe(0);
  });
});
