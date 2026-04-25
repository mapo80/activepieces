import {
  InteractiveFlowTurnEvent,
  isNil,
  WebsocketClientEvent,
} from '@activepieces/shared';
import { useEffect, useRef, useState } from 'react';

import { useSocket } from '@/components/providers/socket-provider';

import {
  applyInteractiveFlowTurnEvent,
  EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
  InteractiveFlowTurnSnapshot,
} from './interactive-flow-turn-reducer';

const DEFAULT_REPLAY_LIMIT = 200;

export function useInteractiveFlowTurnEvents(
  flowRunId: string | undefined,
  options?: { sessionId?: string; replayApiUrl?: string; engineToken?: string },
): InteractiveFlowTurnSnapshot {
  const socket = useSocket();
  const [snapshot, setSnapshot] = useState<InteractiveFlowTurnSnapshot>(
    EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
  );
  const lastSeqRef = useRef<string | null>(null);

  useEffect(() => {
    if (isNil(flowRunId)) {
      setSnapshot(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT);
      lastSeqRef.current = null;
      return;
    }
    const handler = (event: InteractiveFlowTurnEvent): void => {
      if (event.flowRunId !== flowRunId) return;
      lastSeqRef.current = event.sessionSequence;
      setSnapshot((prev) => applyInteractiveFlowTurnEvent(prev, event));
    };
    socket.on(WebsocketClientEvent.INTERACTIVE_FLOW_TURN_EVENT, handler);
    return () => {
      socket.off(WebsocketClientEvent.INTERACTIVE_FLOW_TURN_EVENT, handler);
    };
  }, [flowRunId, socket]);

  useEffect(() => {
    setSnapshot(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT);
    lastSeqRef.current = null;
  }, [flowRunId]);

  useEffect(() => {
    if (
      isNil(options?.sessionId) ||
      isNil(options?.replayApiUrl) ||
      isNil(options?.engineToken)
    )
      return;

    const onReconnect = async (): Promise<void> => {
      const after = lastSeqRef.current ?? '0';
      try {
        const url = `${options.replayApiUrl}?sessionId=${encodeURIComponent(
          options.sessionId!,
        )}&afterSequence=${after}&limit=${DEFAULT_REPLAY_LIMIT}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${options.engineToken}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          events?: InteractiveFlowTurnEvent[];
        };
        if (Array.isArray(body.events)) {
          for (const e of body.events) {
            if (e?.flowRunId === flowRunId) {
              setSnapshot((prev) => applyInteractiveFlowTurnEvent(prev, e));
              lastSeqRef.current = e.sessionSequence;
            }
          }
        }
      } catch {
        // best-effort replay
      }
    };
    socket.on('connect', onReconnect);
    return () => {
      socket.off('connect', onReconnect);
    };
  }, [
    flowRunId,
    socket,
    options?.sessionId,
    options?.replayApiUrl,
    options?.engineToken,
  ]);

  return snapshot;
}
