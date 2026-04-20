import { describe, expect, it } from 'vitest';

import {
  applyInteractiveFlowEvent,
  EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
} from './interactive-flow-runtime-reducer';

describe('applyInteractiveFlowEvent', () => {
  it('stores node status keyed by nodeId', () => {
    const after = applyInteractiveFlowEvent(EMPTY_INTERACTIVE_FLOW_SNAPSHOT, {
      flowRunId: 'r',
      stepName: 's',
      nodeId: 'a',
      kind: 'COMPLETED',
      timestamp: 't',
    });
    expect(after.nodeStatuses).toEqual({ a: 'COMPLETED' });
  });

  it('overwrites an earlier status with the latest one', () => {
    let snap = applyInteractiveFlowEvent(EMPTY_INTERACTIVE_FLOW_SNAPSHOT, {
      flowRunId: 'r',
      stepName: 's',
      nodeId: 'a',
      kind: 'STARTED',
      timestamp: 't',
    });
    snap = applyInteractiveFlowEvent(snap, {
      flowRunId: 'r',
      stepName: 's',
      nodeId: 'a',
      kind: 'COMPLETED',
      timestamp: 't',
    });
    expect(snap.nodeStatuses).toEqual({ a: 'COMPLETED' });
  });

  it('records BRANCH_SELECTED without touching nodeStatuses, skipping when branchId is missing', () => {
    const afterWithBranch = applyInteractiveFlowEvent(
      EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
      {
        flowRunId: 'r',
        stepName: 's',
        nodeId: 'router',
        kind: 'BRANCH_SELECTED',
        branchId: 'b1',
        timestamp: 't',
      },
    );
    expect(afterWithBranch.selectedBranches).toEqual({ router: 'b1' });
    expect(afterWithBranch.nodeStatuses).toEqual({});

    const afterWithoutBranch = applyInteractiveFlowEvent(afterWithBranch, {
      flowRunId: 'r',
      stepName: 's',
      nodeId: 'router',
      kind: 'BRANCH_SELECTED',
      timestamp: 't',
    });
    expect(afterWithoutBranch).toBe(afterWithBranch);
  });
});
