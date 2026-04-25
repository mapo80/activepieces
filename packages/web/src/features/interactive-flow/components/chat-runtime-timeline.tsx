import { InteractiveFlowTurnEvent } from '@activepieces/shared';

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
  turnEvents?: InteractiveFlowTurnEvent[];
  nodeLabels?: Record<string, string>;
};

export function ChatRuntimeTimeline({
  active,
  entries,
  turnEvents,
  nodeLabels,
}: ChatRuntimeTimelineProps): React.ReactElement | null {
  const hasContent = entries.length > 0 || (turnEvents?.length ?? 0) > 0;
  if (!active && !hasContent) return null;
  if (!hasContent) {
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
          key={`node-${nodeId}`}
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
      {turnEvents?.map((event) => (
        <div
          key={`turn-${event.outboxEventId}`}
          data-testid={`chat-runtime-timeline-turn-${event.kind}`}
          className="flex items-center gap-2"
        >
          <span aria-hidden="true">{turnEventEmoji(event.kind)}</span>
          <span className="text-muted-foreground">{turnEventLabel(event)}</span>
        </div>
      ))}
      {active && <InlineDots className="pt-1" />}
    </div>
  );
}

function turnEventEmoji(kind: InteractiveFlowTurnEvent['kind']): string {
  switch (kind) {
    case 'FIELD_EXTRACTED':
      return '📝';
    case 'FIELD_REJECTED':
      return '⚠️';
    case 'META_ANSWERED':
      return '💬';
    case 'INFO_ANSWERED':
      return 'ℹ️';
    case 'TOPIC_CHANGED':
      return '🔄';
    case 'OVERWRITE_PENDING':
      return '❓';
    case 'OVERWRITE_CONFIRMED':
    case 'OVERWRITE_REJECTED':
      return '↩';
    case 'CANCEL_REQUESTED':
      return '⚠';
    case 'CANCEL_CONFIRMED':
      return '🛑';
    case 'CANCEL_REJECTED':
    case 'CANCEL_TTL_EXPIRED':
      return '↩';
    case 'REPROMPT_EMITTED':
      return '↻';
    case 'TURN_COMMITTED':
      return '✓';
    case 'TURN_ROLLED_BACK':
    case 'TURN_FAILED':
      return '✕';
    case 'TURN_LEASE_EXPIRED':
    case 'CATALOG_PREEXEC_FAILED':
      return '⏱';
    default:
      return '•';
  }
}

function turnEventLabel(event: InteractiveFlowTurnEvent): string {
  const payload = event.payload as Record<string, unknown>;
  switch (event.kind) {
    case 'FIELD_EXTRACTED':
      return `Estratto: ${String(payload.field ?? '')} = ${formatValue(
        payload.value,
      )}`;
    case 'META_ANSWERED':
      return `Risposta conversazionale (${String(payload.kind ?? '')})`;
    case 'INFO_ANSWERED':
      return `Risposta informativa: ${String(payload.infoIntent ?? '')}`;
    case 'CANCEL_REQUESTED':
      return 'Annullamento proposto';
    case 'CANCEL_CONFIRMED':
      return 'Flusso annullato';
    case 'CANCEL_REJECTED':
      return 'Annullamento revocato';
    case 'CANCEL_TTL_EXPIRED':
      return 'Annullamento scaduto';
    case 'REPROMPT_EMITTED':
      return `Richiesta riformulazione (${String(payload.reason ?? '')})`;
    case 'TURN_COMMITTED':
      return 'Turno acquisito';
    case 'TURN_ROLLED_BACK':
      return 'Turno annullato (rollback)';
    case 'TURN_FAILED':
      return 'Turno fallito';
    default:
      return event.kind;
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.length > 30 ? `${v.slice(0, 30)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v).slice(0, 30);
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
