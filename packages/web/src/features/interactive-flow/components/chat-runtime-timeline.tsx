import { cn } from '@/lib/utils';

import { InteractiveFlowStepEntry } from '../hooks/use-interactive-flow-current-turn';

import {
  humanizeNodeId,
  runtimeStepLabelColor,
  RuntimeStepIcon,
} from './runtime-step-icon';

type ChatRuntimeTimelineProps = {
  active: boolean;
  entries: InteractiveFlowStepEntry[];
  nodeLabels?: Record<string, string>;
};

export function ChatRuntimeTimeline({
  active,
  entries,
  nodeLabels,
}: ChatRuntimeTimelineProps): React.ReactElement | null {
  if (!active && entries.length === 0) return null;
  if (entries.length === 0) {
    return (
      <div className="flex min-h-6 items-center">
        <InlineDots />
      </div>
    );
  }
  return (
    <div
      data-testid="chat-runtime-timeline"
      className="flex flex-col gap-1.5 text-sm"
    >
      {entries.map(({ nodeId, status }) => (
        <div
          key={nodeId}
          data-testid={`chat-runtime-timeline-item-${nodeId}`}
          data-status={status}
          className="flex items-center gap-2"
        >
          <RuntimeStepIcon status={status} />
          <span className={runtimeStepLabelColor(status)}>
            {nodeLabels?.[nodeId] ?? humanizeNodeId(nodeId)}
          </span>
        </div>
      ))}
      {active && <InlineDots className="pt-1" />}
    </div>
  );
}

function InlineDots({ className }: { className?: string }): React.ReactElement {
  return (
    <div
      aria-label="thinking"
      className={cn('flex items-center gap-1', className)}
    >
      <span
        className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '120ms' }}
      />
      <span
        className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '240ms' }}
      />
    </div>
  );
}
