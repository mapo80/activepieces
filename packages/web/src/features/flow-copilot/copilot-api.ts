import type {
  CopilotEvent,
  CopilotSessionCreateRequest,
  CopilotSessionCreateResponse,
  FlowVersion,
} from '@activepieces/shared';

import { authenticationSession } from '@/lib/authentication-session';

import { readNdjsonStream } from './copilot-stream-reader';

const API_BASE = '/api/v1/ai/copilot';

function authHeaders(): Record<string, string> {
  const token = authenticationSession.getToken();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function createSession(
  body: CopilotSessionCreateRequest,
): Promise<CopilotSessionCreateResponse> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return (await res.json()) as CopilotSessionCreateResponse;
}

async function sendMessage(params: {
  sessionId: string;
  message: string;
  signal?: AbortSignal;
}): Promise<AsyncGenerator<CopilotEvent>> {
  const res = await fetch(`${API_BASE}/sessions/${params.sessionId}/message`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message: params.message }),
    signal: params.signal,
  });
  if (!res.ok && res.status !== 200) {
    const text = await res.text();
    throw new Error(`sendMessage failed: ${res.status} ${text}`);
  }
  return readNdjsonStream(res);
}

async function undo(params: {
  sessionId: string;
  mode: 'copilot-only' | 'reset-to-snapshot';
}): Promise<{ flowVersion: FlowVersion }> {
  const res = await fetch(`${API_BASE}/sessions/${params.sessionId}/undo`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ mode: params.mode }),
  });
  if (!res.ok) throw new Error(`undo failed: ${res.status}`);
  return (await res.json()) as { flowVersion: FlowVersion };
}

async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export const copilotApi = {
  createSession,
  sendMessage,
  undo,
  deleteSession,
};
