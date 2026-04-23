import { FlowVersion } from '@activepieces/shared';
import { Bot, Send, X } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

import { copilotApi } from './copilot-api';
import { useCopilotStore, CopilotMessage } from './copilot-store';
import { SummaryCard } from './summary-card';
import { ToolCallCard } from './tool-call-card';

type Props = {
  flowId: string;
  setFlowVersion: (v: FlowVersion) => void;
};

export function CopilotPanel({ flowId, setFlowVersion }: Props) {
  const {
    messages,
    sessionId,
    scope,
    isStreaming,
    hasManualEditSinceSession,
    close,
  } = useCopilotStore((s) => ({
    messages: s.messages,
    sessionId: s.sessionId,
    scope: s.scope,
    isStreaming: s.isStreaming,
    hasManualEditSinceSession: s.hasManualEditSinceSession,
    close: s.close,
  }));
  const draftInput = useCopilotStore((s) => s.draftInput);
  const setDraftInput = useCopilotStore((s) => s.setDraftInput);
  const startSession = useCopilotStore((s) => s.startSession);
  const appendUserMessage = useCopilotStore((s) => s.appendUserMessage);
  const startAssistantMessage = useCopilotStore((s) => s.startAssistantMessage);
  const appendTextDelta = useCopilotStore((s) => s.appendTextDelta);
  const startToolCall = useCopilotStore((s) => s.startToolCall);
  const markFlowUpdated = useCopilotStore((s) => s.markFlowUpdated);
  const endToolCall = useCopilotStore((s) => s.endToolCall);
  const setSummary = useCopilotStore((s) => s.setSummary);
  const setStreaming = useCopilotStore((s) => s.setStreaming);

  const handleSend = React.useCallback(async () => {
    const message = draftInput.trim();
    if (!message || isStreaming) return;
    setDraftInput('');
    try {
      let effectiveSessionId = sessionId;
      if (!effectiveSessionId) {
        const created = await copilotApi.createSession({ flowId });
        startSession({
          sessionId: created.sessionId,
          scope: created.scope,
          flowId,
        });
        effectiveSessionId = created.sessionId;
      }
      appendUserMessage(message);
      const assistantId = startAssistantMessage();
      setStreaming(true);
      const events = await copilotApi.sendMessage({
        sessionId: effectiveSessionId,
        message,
      });
      for await (const ev of events) {
        switch (ev.type) {
          case 'text-delta':
            appendTextDelta(assistantId, ev.delta);
            break;
          case 'tool-call-start':
            startToolCall({
              assistantId,
              toolCallId: ev.toolCallId,
              name: ev.name,
              args: ev.args,
            });
            break;
          case 'flow-updated':
            setFlowVersion(ev.flowVersion);
            markFlowUpdated(ev.toolCallId);
            break;
          case 'flow-created':
            markFlowUpdated(ev.toolCallId);
            toast.info('Nuovo flow creato dal copilot');
            break;
          case 'tool-call-end':
            endToolCall({
              toolCallId: ev.toolCallId,
              result: ev.result,
              error: ev.error,
            });
            break;
          case 'summary':
            setSummary({
              assistantId,
              text: ev.text,
              appliedCount: ev.appliedCount,
              questions: ev.questions,
            });
            break;
          case 'error':
            toast.error(`Copilot: ${ev.message}`);
            break;
          case 'done':
            break;
        }
      }
    } catch (err) {
      toast.error(`Copilot error: ${(err as Error).message}`);
    } finally {
      setStreaming(false);
    }
  }, [
    draftInput,
    isStreaming,
    setDraftInput,
    sessionId,
    flowId,
    startSession,
    appendUserMessage,
    startAssistantMessage,
    setStreaming,
    appendTextDelta,
    startToolCall,
    setFlowVersion,
    markFlowUpdated,
    endToolCall,
    setSummary,
  ]);

  const handleUndo = React.useCallback(
    async (mode: 'copilot-only' | 'reset-to-snapshot') => {
      if (!sessionId) return;
      try {
        const { flowVersion } = await copilotApi.undo({ sessionId, mode });
        setFlowVersion(flowVersion);
        toast.success(
          mode === 'copilot-only'
            ? 'Modifiche del copilot annullate'
            : 'Stato iniziale ripristinato',
        );
      } catch (err) {
        toast.error(`Undo failed: ${(err as Error).message}`);
      }
    },
    [sessionId, setFlowVersion],
  );

  return (
    <div className="h-full flex flex-col border-l" data-testid="copilot-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="font-semibold text-sm">Flow Copilot</span>
          {scope && (
            <span className="text-xs text-muted-foreground">/ {scope}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          data-testid="copilot-close"
        >
          <X className="size-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 px-3 py-2">
        <div className="space-y-2">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground p-2">
              Descrivi cosa vuoi modificare nel flow. Il copilot applicherà le
              modifiche in tempo reale.
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              showResetToSnapshot={hasManualEditSinceSession}
              onUndoCopilotOnly={() => handleUndo('copilot-only')}
              onResetToSnapshot={() => handleUndo('reset-to-snapshot')}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-2 space-y-2">
        <Textarea
          value={draftInput}
          onChange={(e) => setDraftInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Descrivi la modifica..."
          className="resize-none min-h-[60px] text-sm"
          data-testid="copilot-input"
          disabled={isStreaming}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={isStreaming || !draftInput.trim()}
            data-testid="copilot-send"
          >
            <Send className="size-4 mr-1" />
            Invia
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble(props: {
  message: CopilotMessage;
  showResetToSnapshot: boolean;
  onUndoCopilotOnly: () => void;
  onResetToSnapshot: () => void;
}) {
  if (props.message.kind === 'user') {
    return (
      <div
        className="text-sm px-3 py-2 bg-primary/10 rounded-md whitespace-pre-wrap"
        data-testid="copilot-user-bubble"
      >
        {props.message.text}
      </div>
    );
  }
  const textContent = props.message.textParts.join('');
  return (
    <div className="space-y-1" data-testid="copilot-assistant-bubble">
      {textContent && (
        <div className="text-sm whitespace-pre-wrap">{textContent}</div>
      )}
      {props.message.toolCalls.map((tc) => (
        <ToolCallCard key={tc.toolCallId} card={tc} />
      ))}
      {props.message.summary && (
        <SummaryCard
          text={props.message.summary.text}
          appliedCount={props.message.summary.appliedCount}
          questions={props.message.summary.questions}
          showResetToSnapshot={props.showResetToSnapshot}
          onUndoCopilotOnly={props.onUndoCopilotOnly}
          onResetToSnapshot={props.onResetToSnapshot}
        />
      )}
    </div>
  );
}
