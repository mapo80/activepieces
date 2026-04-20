import {
  InteractiveFlowNodeStateEvent,
  isNil,
  WebsocketClientEvent,
} from '@activepieces/shared';
import { useEffect, useState } from 'react';

import { useSocket } from '@/components/providers/socket-provider';

import {
  applyInteractiveFlowEvent,
  EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  InteractiveFlowRuntimeSnapshot,
} from './interactive-flow-runtime-reducer';

export function useInteractiveFlowNodeStates(
  runId: string | undefined,
): InteractiveFlowRuntimeSnapshot {
  const socket = useSocket();
  const [snapshot, setSnapshot] = useState<InteractiveFlowRuntimeSnapshot>(
    EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  );

  useEffect(() => {
    if (isNil(runId)) {
      setSnapshot(EMPTY_INTERACTIVE_FLOW_SNAPSHOT);
      return;
    }
    const handler = (event: InteractiveFlowNodeStateEvent): void => {
      if (event.flowRunId !== runId) return;
      setSnapshot((prev) => applyInteractiveFlowEvent(prev, event));
    };
    socket.on(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, handler);
    return () => {
      socket.off(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, handler);
    };
  }, [runId, socket]);

  useEffect(() => {
    setSnapshot(EMPTY_INTERACTIVE_FLOW_SNAPSHOT);
  }, [runId]);

  return snapshot;
}
