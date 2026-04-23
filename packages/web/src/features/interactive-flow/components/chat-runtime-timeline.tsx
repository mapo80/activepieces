import { Check, Circle, Loader2, PauseCircle, X } from 'lucide-react';

import MessageLoading from '@/features/chat/chat-bubble/message-loading';
import { cn } from '@/lib/utils';

import { InteractiveFlowNodeStatus } from '../hooks/interactive-flow-runtime-reducer';
import { useInteractiveFlowCurrentTurn } from '../hooks/use-interactive-flow-current-turn';

type ChatRuntimeTimelineProps = {
  active: boolean;
};

export function ChatRuntimeTimeline({
  active,
}: ChatRuntimeTimelineProps): React.ReactElement | null {
  const { snapshot } = useInteractiveFlowCurrentTurn(active);
  const entries = Object.entries(snapshot.nodeStatuses);

  if (!active) return null;
  if (entries.length === 0) {
    return (
      <div className="flex items-center">
        <MessageLoading />
      </div>
    );
  }

  return (
    <div
      data-testid="chat-runtime-timeline"
      className="flex flex-col gap-1.5 text-xs"
    >
      {entries.map(([nodeId, status]) => (
        <div
          key={nodeId}
          data-testid={`chat-runtime-timeline-item-${nodeId}`}
          data-status={status}
          className="flex items-center gap-2"
        >
          <StatusIcon status={status} />
          <span className={cn('text-muted-foreground', labelColor(status))}>
            {humanize(nodeId)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusIcon({
  status,
}: {
  status: InteractiveFlowNodeStatus;
}): React.ReactElement {
  switch (status) {
    case 'STARTED':
      return <Loader2 className="size-3 shrink-0 animate-spin text-primary" />;
    case 'COMPLETED':
      return <Check className="size-3 shrink-0 text-green-600" />;
    case 'FAILED':
      return <X className="size-3 shrink-0 text-destructive" />;
    case 'PAUSED':
      return <PauseCircle className="size-3 shrink-0 text-amber-500" />;
    case 'SKIPPED':
      return <Circle className="size-3 shrink-0 text-muted-foreground/50" />;
  }
}

function labelColor(status: InteractiveFlowNodeStatus): string {
  switch (status) {
    case 'FAILED':
      return 'text-destructive';
    case 'COMPLETED':
      return 'text-foreground';
    default:
      return '';
  }
}

function humanize(nodeId: string): string {
  return nodeId.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
