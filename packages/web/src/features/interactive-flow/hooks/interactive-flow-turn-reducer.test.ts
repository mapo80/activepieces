import { describe, expect, it } from 'vitest';

import {
  applyInteractiveFlowTurnEvent,
  EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
  InteractiveFlowTurnSnapshot,
} from './interactive-flow-turn-reducer';

const baseEvent = (seq: string, id: string, flowRunId = 'run-1'): never =>
  ({
    outboxEventId: id,
    turnId: 't-' + id,
    sessionId: 's',
    flowRunId,
    sessionSequence: seq,
    kind: 'TURN_COMMITTED',
    payload: {},
    timestamp: new Date().toISOString(),
  } as never);

describe('EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT', () => {
  it('starts with empty events + null lastSessionSequence', () => {
    expect(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT.events).toEqual([]);
    expect(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT.flowRunId).toBeNull();
    expect(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT.lastSessionSequence).toBeNull();
    expect(EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT.byOutboxEventId).toEqual({});
  });
});

describe('applyInteractiveFlowTurnEvent', () => {
  it('appends a new event in sequence order', () => {
    const e = baseEvent('1', 'a');
    const next = applyInteractiveFlowTurnEvent(
      EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
      e,
    );
    expect(next.events).toEqual([e]);
    expect(next.lastSessionSequence).toBe('1');
    expect(next.byOutboxEventId.a).toBe(true);
  });

  it('captures the first flowRunId observed', () => {
    const e = baseEvent('1', 'a', 'run-x');
    const next = applyInteractiveFlowTurnEvent(
      EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT,
      e,
    );
    expect(next.flowRunId).toBe('run-x');
  });

  it('keeps events sorted by BigInt sessionSequence (out-of-order delivery)', () => {
    let s: InteractiveFlowTurnSnapshot = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    s = applyInteractiveFlowTurnEvent(s, baseEvent('100', 'a'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('2', 'b'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('25', 'c'));
    expect(s.events.map((e) => e.sessionSequence)).toEqual(['2', '25', '100']);
  });

  it('handles huge bigint sequence values (above Number.MAX_SAFE_INTEGER)', () => {
    let s: InteractiveFlowTurnSnapshot = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    s = applyInteractiveFlowTurnEvent(s, baseEvent('9007199254740993', 'a'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('9007199254740992', 'b'));
    expect(s.events.map((e) => e.sessionSequence)).toEqual([
      '9007199254740992',
      '9007199254740993',
    ]);
  });

  it('deduplicates by outboxEventId (idempotent on replay)', () => {
    let s: InteractiveFlowTurnSnapshot = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    s = applyInteractiveFlowTurnEvent(s, baseEvent('1', 'a'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('1', 'a'));
    expect(s.events).toHaveLength(1);
  });

  it('preserves ordering when events arrive in reverse', () => {
    let s: InteractiveFlowTurnSnapshot = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    s = applyInteractiveFlowTurnEvent(s, baseEvent('5', 'e'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('4', 'd'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('3', 'c'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('2', 'b'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('1', 'a'));
    expect(s.events.map((e) => e.outboxEventId)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('lastSessionSequence reflects highest observed sequence (post-sort)', () => {
    let s: InteractiveFlowTurnSnapshot = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    s = applyInteractiveFlowTurnEvent(s, baseEvent('100', 'a'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('2', 'b'));
    expect(s.lastSessionSequence).toBe('100');
  });

  it('does not mutate the previous snapshot (pure)', () => {
    const e = baseEvent('1', 'a');
    const prev = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    const next = applyInteractiveFlowTurnEvent(prev, e);
    expect(next).not.toBe(prev);
    expect(prev.events).toEqual([]);
  });

  it('keeps the original flowRunId across subsequent events', () => {
    let s: InteractiveFlowTurnSnapshot = EMPTY_INTERACTIVE_FLOW_TURN_SNAPSHOT;
    s = applyInteractiveFlowTurnEvent(s, baseEvent('1', 'a', 'run-1'));
    s = applyInteractiveFlowTurnEvent(s, baseEvent('2', 'b', 'run-2'));
    expect(s.flowRunId).toBe('run-1');
  });
});
