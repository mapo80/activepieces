import {
  ApErrorParams,
  BlockSchema,
  ChatUIResponse,
  FileResponseInterface,
  isNil,
} from '@activepieces/shared';
import { BotIcon } from 'lucide-react';
import React from 'react';
import { z } from 'zod';

import { RuntimeStepIcon } from '@/features/interactive-flow/components/runtime-step-icon';
import { cn } from '@/lib/utils';

import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from '../chat-bubble';
import { ChatMessage } from '../chat-input';
import { MultiMediaMessage } from '../chat-message';

import { ErrorBubble } from './error-bubble';

const RuntimeSummaryStep = z.object({
  nodeId: z.string(),
  label: z.string(),
  status: z.enum(['STARTED', 'COMPLETED', 'FAILED', 'SKIPPED', 'PAUSED']),
});
export type RuntimeSummaryStep = z.infer<typeof RuntimeSummaryStep>;

export const Messages = z.array(
  z.object({
    role: z.union([z.literal('user'), z.literal('bot')]),
    textContent: z.string().optional(),
    files: z.array(FileResponseInterface).optional(),
    blocks: z.array(BlockSchema).optional(),
    runtimeSummary: z.array(RuntimeSummaryStep).optional(),
  }),
);
export type Messages = z.infer<typeof Messages>;

interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  messagesRef?: React.RefObject<HTMLDivElement | null>;
  messages?: Messages;
  chatUI?: ChatUIResponse | null | undefined;
  sendingError?: ApErrorParams | null;
  isSending?: boolean;
  flowId?: string;
  sendMessage?: (arg0: { isRetrying: boolean; message: ChatMessage }) => void;
  setSelectedImage?: (image: string | null) => void;
  onPick?: (payload: string) => void;
  runtimeIndicator?: React.ReactNode;
}

const ChatMessageList = React.forwardRef<HTMLDivElement, ChatMessageListProps>(
  (
    {
      className,
      children,
      messagesRef,
      messages,
      chatUI,
      sendingError,
      isSending,
      flowId,
      sendMessage,
      setSelectedImage,
      onPick,
      runtimeIndicator,
      ...props
    },
    ref,
  ) => {
    if (messages && messages.length > 0) {
      return (
        <div className="h-full w-full max-w-3xl flex items-center justify-center overflow-y-auto">
          <div
            className={cn('flex flex-col w-full h-full p-4 gap-2', className)}
            ref={messagesRef || ref}
            {...props}
          >
            {messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1;
              return (
                <ChatBubble
                  id={isLastMessage ? 'last-message' : undefined}
                  key={index}
                  variant={message.role === 'user' ? 'sent' : 'received'}
                  className={cn(
                    'flex items-start',
                    isLastMessage ? 'pb-8' : '',
                  )}
                >
                  {message.role === 'bot' && (
                    <ChatBubbleAvatar
                      src={chatUI?.platformLogoUrl}
                      fallback={<BotIcon className="size-5" />}
                    />
                  )}
                  <ChatBubbleMessage
                    className={cn(
                      'flex flex-col gap-2',
                      message.role === 'bot' ? 'w-full' : '',
                    )}
                  >
                    {message.role === 'bot' &&
                      message.runtimeSummary &&
                      message.runtimeSummary.length > 0 && (
                        <RuntimeSummaryDetails steps={message.runtimeSummary} />
                      )}
                    <MultiMediaMessage
                      textContent={message.textContent}
                      attachments={message.files}
                      blocks={message.blocks}
                      role={message.role}
                      setSelectedImage={setSelectedImage || (() => {})}
                      onPick={onPick}
                    />
                  </ChatBubbleMessage>
                </ChatBubble>
              );
            })}
            {sendingError && !isSending && flowId && sendMessage && (
              <ErrorBubble
                chatUI={chatUI}
                flowId={flowId}
                sendingError={sendingError}
                sendMessage={(arg0) => {
                  if (!isNil(arg0.message)) {
                    sendMessage({
                      isRetrying: false,
                      message: arg0.message!,
                    });
                  }
                }}
              />
            )}
            {isSending && (
              <ChatBubble variant="received" className="items-center pb-8">
                <ChatBubbleAvatar
                  src={chatUI?.platformLogoUrl}
                  fallback={<BotIcon className="size-5" />}
                />
                {runtimeIndicator ? (
                  <ChatBubbleMessage className="flex flex-col gap-2 w-full justify-center">
                    {runtimeIndicator}
                  </ChatBubbleMessage>
                ) : (
                  <ChatBubbleMessage isLoading />
                )}
              </ChatBubble>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="h-full w-full flex items-center justify-center overflow-y-auto">
        <div
          className={cn('flex flex-col w-full h-full p-4 gap-2', className)}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  },
);

ChatMessageList.displayName = 'ChatMessageList';

function RuntimeSummaryDetails({
  steps,
}: {
  steps: RuntimeSummaryStep[];
}): React.ReactElement {
  return (
    <details
      data-testid="chat-runtime-summary"
      className="text-sm text-muted-foreground border-l-2 border-muted pl-3"
    >
      <summary className="cursor-pointer select-none py-0.5">
        Passi eseguiti ({steps.length})
      </summary>
      <div className="flex flex-col gap-1 pt-2 pb-1">
        {steps.map((step) => (
          <div
            key={step.nodeId}
            data-testid={`chat-runtime-summary-item-${step.nodeId}`}
            data-status={step.status}
            className="flex items-center gap-2"
          >
            <RuntimeStepIcon status={step.status} />
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export { ChatMessageList };
