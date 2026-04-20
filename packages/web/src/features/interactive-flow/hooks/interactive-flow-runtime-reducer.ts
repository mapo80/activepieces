import { InteractiveFlowNodeStateEvent, isNil } from '@activepieces/shared';

export type InteractiveFlowNodeStatus =
  | 'STARTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'PAUSED';

export type InteractiveFlowRuntimeSnapshot = {
  nodeStatuses: Record<string, InteractiveFlowNodeStatus>;
  selectedBranches: Record<string, string>;
};

export const EMPTY_INTERACTIVE_FLOW_SNAPSHOT: InteractiveFlowRuntimeSnapshot = {
  nodeStatuses: {},
  selectedBranches: {},
};

export function applyInteractiveFlowEvent(
  prev: InteractiveFlowRuntimeSnapshot,
  event: InteractiveFlowNodeStateEvent,
): InteractiveFlowRuntimeSnapshot {
  if (event.kind === 'BRANCH_SELECTED') {
    if (isNil(event.branchId)) return prev;
    return {
      ...prev,
      selectedBranches: {
        ...prev.selectedBranches,
        [event.nodeId]: event.branchId,
      },
    };
  }
  return {
    ...prev,
    nodeStatuses: {
      ...prev.nodeStatuses,
      [event.nodeId]: event.kind,
    },
  };
}
