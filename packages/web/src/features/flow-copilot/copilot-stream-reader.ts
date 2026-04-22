import { CopilotEvent } from '@activepieces/shared';

export async function* readNdjsonStream(
  response: Response,
): AsyncGenerator<CopilotEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const normalized = buffer.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as CopilotEvent;
      } catch {
        // skip malformed line, continue streaming
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as CopilotEvent;
    } catch {
      // ignore
    }
  }
}
