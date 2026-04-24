import {
  ApErrorParams,
  ChatUIResponse,
  ErrorCode,
  isNil,
  HumanInputFormResultTypes,
} from '@activepieces/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { nanoid } from 'nanoid';
import { useEffect, useRef, useState } from 'react';

import { ChatDrawerSource } from '@/app/builder/types';
import { LoadingScreen } from '@/components/custom/loading-screen';
import {
  ChatInput,
  ChatMessage,
  ChatIntro,
  ImageDialog,
  ChatMessageList,
  Messages,
  RuntimeSummaryStep,
} from '@/features/chat';
import { humanInputApi } from '@/features/forms';
import { ChatRuntimeTimeline } from '@/features/interactive-flow/components/chat-runtime-timeline';
import { humanizeNodeId } from '@/features/interactive-flow/components/runtime-step-icon';
import { useInteractiveFlowCurrentTurn } from '@/features/interactive-flow/hooks/use-interactive-flow-current-turn';
import { cn } from '@/lib/utils';

import NotFoundPage from '../404-page';

interface FlowChatProps {
  flowId: string;
  className?: string;
  showWelcomeMessage?: boolean;
  mode: ChatDrawerSource | null;
  onError?: (error: ApErrorParams | null) => void;
  onSendingMessage?: (message: ChatMessage) => void;
  closeChat?: () => void;
  messages?: Messages;
  chatSessionId?: string | null;
  onAddMessage?: (message: Messages[0]) => void;
  onSetSessionId?: (sessionId: string) => void;
  nodeLabels?: Record<string, string>;
}

export function FlowChat({
  flowId,
  className,
  showWelcomeMessage = true,
  mode,
  onError,
  onSendingMessage,
  closeChat,
  messages = [],
  chatSessionId,
  onAddMessage,
  onSetSessionId,
  nodeLabels,
}: FlowChatProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const {
    data: chatUI,
    isLoading,
    isError: isLoadingError,
  } = useQuery<ChatUIResponse | null, Error>({
    queryKey: ['chat', flowId],
    queryFn: () =>
      humanInputApi.getChatUI(
        flowId,
        mode === ChatDrawerSource.TEST_FLOW ||
          mode === ChatDrawerSource.TEST_STEP
          ? true
          : false,
      ),
    enabled: !isNil(flowId),
    staleTime: Infinity,
    retry: false,
  });

  const scrollToBottom = () => {
    setTimeout(() => {
      const lastMessage = document.getElementById('last-message');
      if (lastMessage) {
        lastMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  // Initialize chat session ID if not set and we have the callback
  useEffect(() => {
    if (!chatSessionId && onSetSessionId) {
      onSetSessionId(nanoid());
    }
  }, [chatSessionId, onSetSessionId]);

  const previousInputRef = useRef('');
  const previousFilesRef = useRef<File[]>([]);
  const [sendingError, setSendingError] = useState<ApErrorParams | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

  const botName =
    chatUI?.props.botName ?? `${chatUI?.platformName ?? 'Activepieces'} Bot`;

  const { mutate: sendMessage, isPending: isSending } = useMutation({
    mutationFn: async ({
      isRetrying,
      message,
    }: {
      isRetrying: boolean;
      message?: ChatMessage;
    }) => {
      if (!flowId || !chatSessionId) return null;

      const savedInput = isRetrying
        ? previousInputRef.current
        : message?.textContent || '';
      const savedFiles = isRetrying
        ? previousFilesRef.current
        : message?.files || [];

      previousInputRef.current = savedInput;
      previousFilesRef.current = savedFiles;

      if (!isRetrying && message && onAddMessage) {
        onAddMessage({
          role: 'user',
          textContent: savedInput,
          files: savedFiles.map((file) => ({
            url: URL.createObjectURL(file),
            mimeType: file.type,
          })),
        });
      }

      scrollToBottom();
      const isDraft = mode === ChatDrawerSource.TEST_FLOW;
      const isTestStep = mode === ChatDrawerSource.TEST_STEP;
      return humanInputApi.sendMessage({
        flowId,
        chatId: chatSessionId,
        message: savedInput,
        files: savedFiles,
        mode: isDraft ? 'draft' : isTestStep ? 'test' : 'locked',
      });
    },

    onSuccess: (result) => {
      if (mode === ChatDrawerSource.TEST_STEP) {
        closeChat?.();
      }
      if (!result) {
        const error: ApErrorParams = {
          code: ErrorCode.NO_CHAT_RESPONSE,
          params: {},
        };
        setSendingError(error);
        onError?.(error);
        return;
      }

      if ('type' in result && onAddMessage) {
        setSendingError(null);
        onError?.(null);

        const runtimeSummary = buildRuntimeSummaryFromSnapshot();

        switch (result.type) {
          case HumanInputFormResultTypes.FILE: {
            if ('url' in result.value) {
              onAddMessage({
                role: 'bot',
                files: [
                  {
                    url: result.value.url,
                    mimeType: result.value.mimeType,
                  },
                ],
                runtimeSummary,
              });
            }
            break;
          }

          case HumanInputFormResultTypes.MARKDOWN: {
            const validFiles = (result.files ?? []).filter(
              (file) => 'url' in file && 'mimeType' in file,
            );

            onAddMessage({
              role: 'bot',
              textContent: result.value,
              files: validFiles.length > 0 ? validFiles : undefined,
              runtimeSummary,
            });
            break;
          }

          case HumanInputFormResultTypes.BLOCKS_V1: {
            onAddMessage({
              role: 'bot',
              blocks: result.blocks,
              runtimeSummary,
            });
            break;
          }
        }
      }

      scrollToBottom();

      setTimeout(() => {
        if (chatInputRef.current) {
          chatInputRef.current.focus();
        }
      }, 100);
    },

    onError: (error: AxiosError) => {
      const errorData = error.response?.data as ApErrorParams;
      setSendingError(errorData);
      onError?.(errorData);
      scrollToBottom();
    },
  });

  const { entries: runtimeEntries, getLatest: getRuntimeSnapshot } =
    useInteractiveFlowCurrentTurn(isSending);

  function buildRuntimeSummaryFromSnapshot(): RuntimeSummaryStep[] | undefined {
    const snap = getRuntimeSnapshot();
    const entriesNow = Object.entries(snap.nodeStatuses);
    if (entriesNow.length === 0) return undefined;
    return entriesNow.map(([nodeId, status]) => ({
      nodeId,
      label: nodeLabels?.[nodeId] ?? humanizeNodeId(nodeId),
      status,
    }));
  }

  useEffect(scrollToBottom, [messages, isSending]);

  const handleSendMessage = (message: ChatMessage) => {
    onSendingMessage?.(message);
    sendMessage({ isRetrying: false, message });
  };

  const handlePick = (payload: string) => {
    handleSendMessage({ textContent: payload, files: [] });
  };

  if (isLoadingError) {
    return <ChatNotFound />;
  }

  if (isLoading) return <LoadingScreen />;

  const toggleImageDialog = (imageUrl: string | null) => {
    setImageDialogOpen(!!imageUrl);
    setSelectedImage(imageUrl);
  };

  return (
    <main
      className={cn(
        'flex w-full flex-col items-center justify-center pb-6',
        messages.length > 0 ? 'h-screen' : 'h-screen',
        className,
      )}
    >
      {messages.length > 0 ? (
        <>
          <ChatMessageList
            messagesRef={messagesRef}
            messages={messages}
            chatUI={chatUI}
            sendingError={sendingError}
            isSending={isSending}
            flowId={flowId}
            sendMessage={sendMessage}
            setSelectedImage={toggleImageDialog}
            onPick={handlePick}
            runtimeIndicator={
              <ChatRuntimeTimeline
                active={isSending}
                entries={runtimeEntries}
                nodeLabels={nodeLabels}
              />
            }
          />
          <div className="w-full px-4 max-w-3xl">
            <ChatInput
              ref={chatInputRef}
              onSendMessage={handleSendMessage}
              disabled={isSending}
              placeholder="Type your message here..."
            />
          </div>
        </>
      ) : (
        <>
          {showWelcomeMessage && (
            <ChatIntro chatUI={chatUI} botName={botName} />
          )}
          <div className="w-full px-4 max-w-3xl absolute bottom-6">
            <ChatInput
              ref={chatInputRef}
              onSendMessage={handleSendMessage}
              disabled={isSending}
              placeholder="Type your message here..."
            />
          </div>
        </>
      )}
      <ImageDialog
        open={imageDialogOpen}
        onOpenChange={(open) => {
          setImageDialogOpen(open);
          if (!open) setSelectedImage(null);
        }}
        imageUrl={selectedImage}
      />
    </main>
  );
}

export const ChatNotFound = () => {
  return (
    <NotFoundPage
      title="Hmm... this chat isn't here"
      description="The chat you're looking for isn't here or maybe hasn't been published by the owner yet"
    />
  );
};
