import React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCallCard as ToolCallCardModel } from './copilot-store';

export function ToolCallCard({ card }: { card: ToolCallCardModel }) {
  const [expanded, setExpanded] = React.useState(false);
  const icon =
    card.status === 'pending' ? (
      <Loader2 className="size-4 animate-spin text-muted-foreground" data-testid="copilot-tool-pending" />
    ) : card.status === 'success' ? (
      <Check className="size-4 text-green-600" data-testid="copilot-tool-success" />
    ) : (
      <X className="size-4 text-destructive" data-testid="copilot-tool-error" />
    );
  return (
    <div
      className={cn(
        'border rounded-md my-1 text-xs bg-muted/30',
        card.status === 'error' && 'border-destructive/50',
      )}
      data-testid="copilot-tool-call-card"
      data-tool-name={card.name}
      data-status={card.status}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {icon}
        <span className="font-medium">{card.name}</span>
        {card.flowUpdatedPreview && (
          <span className="text-xxs text-green-600">• flow updated</span>
        )}
        <span className="ml-auto text-muted-foreground">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 text-muted-foreground space-y-1">
          <div>
            <div className="text-xxs uppercase tracking-wide">args</div>
            <pre className="whitespace-pre-wrap break-all bg-background p-1 rounded text-xxs">
              {safeStringify(card.args)}
            </pre>
          </div>
          {card.error && (
            <div>
              <div className="text-xxs uppercase tracking-wide text-destructive">error</div>
              <pre className="whitespace-pre-wrap break-all bg-background p-1 rounded text-xxs">
                {card.error}
              </pre>
            </div>
          )}
          {card.result !== undefined && (
            <div>
              <div className="text-xxs uppercase tracking-wide">result</div>
              <pre className="whitespace-pre-wrap break-all bg-background p-1 rounded text-xxs">
                {safeStringify(card.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
