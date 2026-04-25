// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown) => void;
const handlers = new Map<string, Handler>();
const socketMock = {
  on: vi.fn((eventName: string, handler: Handler) => {
    handlers.set(eventName, handler);
  }),
  off: vi.fn((eventName: string, _handler: Handler) => {
    handlers.delete(eventName);
  }),
  emit: vi.fn(),
};

vi.mock('@/components/providers/socket-provider', () => ({
  useSocket: () => socketMock,
}));

import { useInteractiveFlowTurnEvents } from './use-interactive-flow-turn-events';

const fetchMock = vi.fn();

beforeEach(() => {
  handlers.clear();
  socketMock.on.mockClear();
  socketMock.off.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const baseEvent = (
  sessionSequence: string,
  outboxEventId: string,
  flowRunId = 'fr-1',
): unknown => ({
  outboxEventId,
  turnId: 't',
  sessionId: 's',
  flowRunId,
  sessionSequence,
  kind: 'TURN_COMMITTED',
  payload: {},
  createdAt: new Date().toISOString(),
});

describe('useInteractiveFlowTurnEvents', () => {
  it('returns empty snapshot when flowRunId is undefined', () => {
    const { result } = renderHook(() =>
      useInteractiveFlowTurnEvents(undefined),
    );
    expect(result.current.events).toEqual([]);
    expect(socketMock.on).not.toHaveBeenCalledWith(
      'INTERACTIVE_FLOW_TURN_EVENT',
      expect.any(Function),
    );
  });

  it('subscribes to socket on mount when flowRunId is set', () => {
    renderHook(() => useInteractiveFlowTurnEvents('fr-1'));
    expect(socketMock.on).toHaveBeenCalledWith(
      'INTERACTIVE_FLOW_TURN_EVENT',
      expect.any(Function),
    );
  });

  it('appends events that match flowRunId', () => {
    const { result } = renderHook(() => useInteractiveFlowTurnEvents('fr-1'));
    const handler = handlers.get('INTERACTIVE_FLOW_TURN_EVENT')!;
    act(() => {
      handler(baseEvent('1', 'a'));
    });
    expect(result.current.events).toHaveLength(1);
  });

  it('drops events with mismatched flowRunId', () => {
    const { result } = renderHook(() => useInteractiveFlowTurnEvents('fr-1'));
    const handler = handlers.get('INTERACTIVE_FLOW_TURN_EVENT')!;
    act(() => {
      handler(baseEvent('1', 'a', 'fr-OTHER'));
    });
    expect(result.current.events).toEqual([]);
  });

  it('resets snapshot when flowRunId changes', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useInteractiveFlowTurnEvents(id),
      { initialProps: { id: 'fr-1' as string | undefined } },
    );
    const handler = handlers.get('INTERACTIVE_FLOW_TURN_EVENT')!;
    act(() => {
      handler(baseEvent('1', 'a', 'fr-1'));
    });
    expect(result.current.events).toHaveLength(1);
    rerender({ id: 'fr-2' });
    expect(result.current.events).toEqual([]);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useInteractiveFlowTurnEvents('fr-1'));
    unmount();
    expect(socketMock.off).toHaveBeenCalledWith(
      'INTERACTIVE_FLOW_TURN_EVENT',
      expect.any(Function),
    );
  });

  it('replays events via fetch when reconnect fires (sessionId+url+token provided)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [baseEvent('1', 'a'), baseEvent('2', 'b')],
        count: 2,
      }),
    });
    const { result } = renderHook(() =>
      useInteractiveFlowTurnEvents('fr-1', {
        sessionId: 's',
        replayApiUrl:
          'http://api.local/v1/engine/interactive-flow-ai/command-layer/outbox/replay',
        engineToken: 'tok',
      }),
    );
    const reconnect = handlers.get('connect');
    expect(reconnect).toBeDefined();
    await act(async () => {
      await reconnect!(undefined);
    });
    await waitFor(() => expect(result.current.events.length).toBe(2));
  });

  it('handles replay fetch failure gracefully (events stay empty)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() =>
      useInteractiveFlowTurnEvents('fr-1', {
        sessionId: 's',
        replayApiUrl: 'http://api.local/replay',
        engineToken: 'tok',
      }),
    );
    const reconnect = handlers.get('connect');
    await act(async () => {
      await reconnect!(undefined);
    });
    expect(result.current.events).toEqual([]);
  });

  it('handles replay fetch non-ok response (events stay empty)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const { result } = renderHook(() =>
      useInteractiveFlowTurnEvents('fr-1', {
        sessionId: 's',
        replayApiUrl: 'http://api.local/replay',
        engineToken: 'tok',
      }),
    );
    const reconnect = handlers.get('connect');
    await act(async () => {
      await reconnect!(undefined);
    });
    expect(result.current.events).toEqual([]);
  });

  it('does not register reconnect handler when replay options are missing', () => {
    renderHook(() => useInteractiveFlowTurnEvents('fr-1'));
    expect(handlers.has('connect')).toBe(false);
  });
});
