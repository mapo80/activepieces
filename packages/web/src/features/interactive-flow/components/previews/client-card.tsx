import { UserCircle } from 'lucide-react';
import React from 'react';

export function ClientCardThumbnail(): React.ReactElement {
  return (
    <div
      className="flex h-10 w-16 items-center gap-1 rounded border border-border bg-background p-1"
      data-testid="thumb-client-card"
    >
      <div className="size-4 rounded-full bg-muted" />
      <div className="flex flex-col gap-0.5">
        <div className="h-1 w-8 rounded bg-muted-foreground/70" />
        <div className="h-1 w-6 rounded bg-muted" />
      </div>
    </div>
  );
}

export function ClientCardPreview(
  props: Record<string, unknown>,
): React.ReactElement {
  const name = typeof props.name === 'string' ? props.name : 'Unknown';
  const ndg = typeof props.ndg === 'string' ? props.ndg : '—';
  return (
    <div
      className="flex items-center gap-3 rounded border border-border bg-background p-3"
      data-testid="preview-client-card"
    >
      <UserCircle className="size-10 text-muted-foreground" />
      <div className="flex flex-col">
        <div className="text-sm font-semibold">{name}</div>
        <div className="text-xs text-muted-foreground">NDG {ndg}</div>
      </div>
    </div>
  );
}
