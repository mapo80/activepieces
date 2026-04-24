import {
  InteractiveFlowNodeStateEvent,
  WebsocketClientEvent,
} from '@activepieces/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSocket } from '@/components/providers/socket-provider';

import {
  applyInteractiveFlowEvent,
  EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  InteractiveFlowNodeStatus,
  InteractiveFlowRuntimeSnapshot,
} from './interactive-flow-runtime-reducer';

export type InteractiveFlowStepEntry = {
  nodeId: string;
  status: InteractiveFlowNodeStatus;
};

export function useInteractiveFlowCurrentTurn(active: boolean): {
  snapshot: InteractiveFlowRuntimeSnapshot;
  flowRunId: string | undefined;
  entries: InteractiveFlowStepEntry[];
  getLatest: () => InteractiveFlowRuntimeSnapshot;
} {
  const socket = useSocket();
  const runIdRef = useRef<string | undefined>(undefined);
  const snapshotRef = useRef<InteractiveFlowRuntimeSnapshot>(
    EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  );
  const [snapshot, setSnapshot] = useState<InteractiveFlowRuntimeSnapshot>(
    EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  );
  const [flowRunId, setFlowRunId] = useState<string | undefined>(undefined);

  useEffect(() => {
    runIdRef.current = undefined;
    snapshotRef.current = EMPTY_INTERACTIVE_FLOW_SNAPSHOT;
    setSnapshot(EMPTY_INTERACTIVE_FLOW_SNAPSHOT);
    setFlowRunId(undefined);
    if (!active) return;
    const handler = (event: InteractiveFlowNodeStateEvent): void => {
      if (runIdRef.current === undefined) {
        runIdRef.current = event.flowRunId;
        setFlowRunId(event.flowRunId);
      } else if (event.flowRunId !== runIdRef.current) {
        return;
      }
      const next = applyInteractiveFlowEvent(snapshotRef.current, event);
      snapshotRef.current = next;
      setSnapshot(next);
    };
    socket.on(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, handler);
    return () => {
      socket.off(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, handler);
    };
  }, [active, socket]);

  const entries: InteractiveFlowStepEntry[] = Object.entries(
    snapshot.nodeStatuses,
  ).map(([nodeId, status]) => ({ nodeId, status }));

  const getLatest = useCallback(() => snapshotRef.current, []);

  return { snapshot, flowRunId, entries, getLatest };
}
