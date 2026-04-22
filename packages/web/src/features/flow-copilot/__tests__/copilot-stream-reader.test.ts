import { describe, expect, it } from 'vitest';
import { readNdjsonStream } from '../copilot-stream-reader';
import type { CopilotEvent } from '@activepieces/shared';

function bodyFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(response: Response): Promise<CopilotEvent[]> {
  const out: CopilotEvent[] = [];
  for await (const ev of readNdjsonStream(response)) out.push(ev);
  return out;
}

describe('readNdjsonStream', () => {
  it('parses a sequence of LF-terminated events', async () => {
    const events = [
      { type: 'text-delta', delta: 'hello' },
      { type: 'done', tokensUsed: 10, durationMs: 100 },
    ];
    const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const got = await collect(bodyFromChunks([body]));
    expect(got).toEqual(events);
  });

  it('handles \\r\\n line endings and extra whitespace', async () => {
    const payload =
      JSON.stringify({ type: 'text-delta', delta: 'a' }) +
      '\r\n' +
      JSON.stringify({ type: 'text-delta', delta: 'b' }) +
      '\r\n';
    const got = await collect(bodyFromChunks([payload]));
    expect(got).toEqual([
      { type: 'text-delta', delta: 'a' },
      { type: 'text-delta', delta: 'b' },
    ]);
  });

  it('handles chunk boundaries mid-event', async () => {
    const body1 = '{"type":"text-delta","del';
    const body2 = 'ta":"split"}\n';
    const got = await collect(bodyFromChunks([body1, body2]));
    expect(got).toEqual([{ type: 'text-delta', delta: 'split' }]);
  });

  it('skips malformed lines and keeps streaming', async () => {
    const body = `{"type":"text-delta","delta":"ok"}\nNOT-JSON\n{"type":"done","tokensUsed":0,"durationMs":0}\n`;
    const got = await collect(bodyFromChunks([body]));
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({ type: 'text-delta', delta: 'ok' });
    expect(got[1].type).toBe('done');
  });

  it('yields final buffered event without trailing newline', async () => {
    const body = `{"type":"done","tokensUsed":1,"durationMs":2}`;
    const got = await collect(bodyFromChunks([body]));
    expect(got).toEqual([{ type: 'done', tokensUsed: 1, durationMs: 2 }]);
  });

  it('returns empty for a body-less response', async () => {
    const res = new Response(null);
    const out: CopilotEvent[] = [];
    for await (const ev of readNdjsonStream(res)) out.push(ev);
    expect(out).toEqual([]);
  });
});
