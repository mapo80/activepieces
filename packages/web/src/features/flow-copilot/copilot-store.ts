import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CopilotScope, FlowVersion } from '@activepieces/shared';

export type ToolCallCard = {
  toolCallId: string;
  name: string;
  args: unknown;
  status: 'pending' | 'success' | 'error';
  result?: unknown;
  error?: string;
  flowUpdatedPreview?: boolean;
};

export type CopilotMessage =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'assistant';
      id: string;
      textParts: string[];
      toolCalls: ToolCallCard[];
      isStreaming: boolean;
      summary?: { text: string; appliedCount: number; questions: string[] };
    };

type CopilotState = {
  isOpen: boolean;
  draftInput: string;
  sessionId: string | null;
  scope: CopilotScope | null;
  flowId: string | null;
  messages: CopilotMessage[];
  isStreaming: boolean;
  hasManualEditSinceSession: boolean;
};

type CopilotActions = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setDraftInput: (v: string) => void;
  startSession: (params: {
    sessionId: string;
    scope: CopilotScope;
    flowId: string;
  }) => void;
  appendUserMessage: (text: string) => string;
  startAssistantMessage: () => string;
  appendTextDelta: (assistantId: string, delta: string) => void;
  startToolCall: (params: {
    assistantId: string;
    toolCallId: string;
    name: string;
    args: unknown;
  }) => void;
  markFlowUpdated: (toolCallId: string) => void;
  endToolCall: (params: {
    toolCallId: string;
    result?: unknown;
    error?: string;
  }) => void;
  setSummary: (params: {
    assistantId: string;
    text: string;
    appliedCount: number;
    questions?: string[];
  }) => void;
  setStreaming: (v: boolean) => void;
  markManualEdit: () => void;
  clearManualEdit: () => void;
  reset: () => void;
};

const initialState: CopilotState = {
  isOpen: false,
  draftInput: '',
  sessionId: null,
  scope: null,
  flowId: null,
  messages: [],
  isStreaming: false,
  hasManualEditSinceSession: false,
};

export const useCopilotStore = create<CopilotState & CopilotActions>()(
  persist(
    (set) => ({
      ...initialState,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setDraftInput: (v) => set({ draftInput: v }),
      startSession: ({ sessionId, scope, flowId }) =>
        set({
          sessionId,
          scope,
          flowId,
          messages: [],
          hasManualEditSinceSession: false,
        }),
      appendUserMessage: (text) => {
        const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((s) => ({ messages: [...s.messages, { kind: 'user', id, text }] }));
        return id;
      },
      startAssistantMessage: () => {
        const id = `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((s) => ({
          messages: [
            ...s.messages,
            {
              kind: 'assistant',
              id,
              textParts: [],
              toolCalls: [],
              isStreaming: true,
            },
          ],
        }));
        return id;
      },
      appendTextDelta: (assistantId, delta) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.kind === 'assistant' && m.id === assistantId
              ? { ...m, textParts: [...m.textParts, delta] }
              : m,
          ),
        })),
      startToolCall: ({ assistantId, toolCallId, name, args }) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.kind === 'assistant' && m.id === assistantId
              ? {
                  ...m,
                  toolCalls: [
                    ...m.toolCalls,
                    { toolCallId, name, args, status: 'pending' },
                  ],
                }
              : m,
          ),
        })),
      markFlowUpdated: (toolCallId) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.kind === 'assistant'
              ? {
                  ...m,
                  toolCalls: m.toolCalls.map((t) =>
                    t.toolCallId === toolCallId
                      ? { ...t, flowUpdatedPreview: true }
                      : t,
                  ),
                }
              : m,
          ),
        })),
      endToolCall: ({ toolCallId, result, error }) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.kind === 'assistant'
              ? {
                  ...m,
                  toolCalls: m.toolCalls.map((t) =>
                    t.toolCallId === toolCallId
                      ? {
                          ...t,
                          status: error ? 'error' : 'success',
                          result,
                          error,
                        }
                      : t,
                  ),
                }
              : m,
          ),
        })),
      setSummary: ({ assistantId, text, appliedCount, questions }) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.kind === 'assistant' && m.id === assistantId
              ? {
                  ...m,
                  isStreaming: false,
                  summary: { text, appliedCount, questions: questions ?? [] },
                }
              : m,
          ),
        })),
      setStreaming: (v) => set({ isStreaming: v }),
      markManualEdit: () => set({ hasManualEditSinceSession: true }),
      clearManualEdit: () => set({ hasManualEditSinceSession: false }),
      reset: () => set(initialState),
    }),
    {
      name: 'copilot-store',
      partialize: (s) => ({ draftInput: s.draftInput, isOpen: s.isOpen }),
    },
  ),
);
