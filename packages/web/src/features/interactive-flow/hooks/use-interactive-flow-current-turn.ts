import {
  InteractiveFlowNodeStateEvent,
  WebsocketClientEvent,
} from '@activepieces/shared';
import { useEffect, useRef, useState } from 'react';

import { useSocket } from '@/components/providers/socket-provider';

import {
  applyInteractiveFlowEvent,
  EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  InteractiveFlowRuntimeSnapshot,
} from './interactive-flow-runtime-reducer';

export function useInteractiveFlowCurrentTurn(active: boolean): {
  snapshot: InteractiveFlowRuntimeSnapshot;
  flowRunId: string | undefined;
} {
  const socket = useSocket();
  const runIdRef = useRef<string | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<InteractiveFlowRuntimeSnapshot>(
    EMPTY_INTERACTIVE_FLOW_SNAPSHOT,
  );
  const [flowRunId, setFlowRunId] = useState<string | undefined>(undefined);

  useEffect(() => {
    runIdRef.current = undefined;
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
      setSnapshot((prev) => applyInteractiveFlowEvent(prev, event));
    };
    socket.on(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, handler);
    return () => {
      socket.off(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, handler);
    };
  }, [active, socket]);

  return { snapshot, flowRunId };
}
