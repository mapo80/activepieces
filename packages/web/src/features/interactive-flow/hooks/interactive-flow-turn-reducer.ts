import { InteractiveFlowTurnEvent } from '@activepieces/shared';

export type InteractiveFlowTurnEntry = InteractiveFlowTurnEvent;

export type InteractiveFlowTurnSnapshot = {
  flowRunId: string | null;
  events: InteractiveFlowTurnEntry[];
  byOutboxEventId: Record<string, true>;
  lastSessionSequence: string | null;
};

export const EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT: InteractiveFlowTurnSnapshot =
  {
    flowRunId: null,
    events: [],
    byOutboxEventId: {},
    lastSessionSequence: null,
  };

export function applyInteractiveFlowTurnEvent(
  prev: InteractiveFlowTurnSnapshot,
  event: InteractiveFlowTurnEvent,
): InteractiveFlowTurnSnapshot {
  if (prev.byOutboxEventId[event.outboxEventId]) {
    return prev;
  }
  const insertIdx = findInsertionIndex(prev.events, event.sessionSequence);
  const next = [...prev.events];
  next.splice(insertIdx, 0, event);
  const lastSeq =
    next.length > 0 ? next[next.length - 1].sessionSequence : null;
  return {
    flowRunId: prev.flowRunId ?? event.flowRunId,
    events: next,
    byOutboxEventId: { ...prev.byOutboxEventId, [event.outboxEventId]: true },
    lastSessionSequence: lastSeq,
  };
}

function findInsertionIndex(
  events: InteractiveFlowTurnEvent[],
  sessionSequence: string,
): number {
  const target = BigInt(sessionSequence);
  for (let i = 0; i < events.length; i++) {
    if (BigInt(events[i].sessionSequence) > target) return i;
  }
  return events.length;
}
