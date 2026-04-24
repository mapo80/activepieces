import { Check, Circle, Loader2, PauseCircle, X } from 'lucide-react';

import { InteractiveFlowNodeStatus } from '../hooks/interactive-flow-runtime-reducer';

type RuntimeStepIconProps = {
  status: InteractiveFlowNodeStatus | 'IDLE';
};

export function RuntimeStepIcon({
  status,
}: RuntimeStepIconProps): React.ReactElement {
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
    case 'IDLE':
      return <Circle className="size-3 shrink-0 text-muted-foreground/40" />;
  }
}

export function runtimeStepLabelColor(
  status: InteractiveFlowNodeStatus | 'IDLE',
): string {
  switch (status) {
    case 'FAILED':
      return 'text-destructive';
    case 'COMPLETED':
      return 'text-foreground';
    default:
      return 'text-muted-foreground';
  }
}

export function humanizeNodeId(nodeId: string): string {
  return nodeId.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
