import {
  InteractiveFlowTurnEvent,
  isNil,
  WebsocketClientEvent,
} from '@activepieces/shared';
import { useEffect, useState } from 'react';

import { useSocket } from '@/components/providers/socket-provider';

import {
  applyInteractiveFlowTurnEvent,
  EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
  InteractiveFlowTurnSnapshot,
} from './interactive-flow-turn-reducer';

export function useInteractiveFlowTurnEvents(
  flowRunId: string | undefined,
): InteractiveFlowTurnSnapshot {
  const socket = useSocket();
  const [snapshot, setSnapshot] = useState<InteractiveFlowTurnSnapshot>(
    EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
  );

  useEffect(() => {
    if (isNil(flowRunId)) {
      setSnapshot(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT);
      return;
    }
    const handler = (event: InteractiveFlowTurnEvent): void => {
      if (event.flowRunId !== flowRunId) return;
      setSnapshot((prev) => applyInteractiveFlowTurnEvent(prev, event));
    };
    socket.on(WebsocketClientEvent.INTERACTIVE_FLOW_TURN_EVENT, handler);
    return () => {
      socket.off(WebsocketClientEvent.INTERACTIVE_FLOW_TURN_EVENT, handler);
    };
  }, [flowRunId, socket]);

  useEffect(() => {
    setSnapshot(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT);
  }, [flowRunId]);

  return snapshot;
}
