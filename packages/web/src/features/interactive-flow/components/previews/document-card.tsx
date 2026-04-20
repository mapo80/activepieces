import { FileText } from 'lucide-react';
import React from 'react';

export function DocumentCardThumbnail(): React.ReactElement {
  return (
    <div
      className="flex h-10 w-16 items-center gap-1 rounded border border-border bg-background p-1"
      data-testid="thumb-document-card"
    >
      <div className="size-5 rounded bg-muted" />
      <div className="flex flex-col gap-0.5">
        <div className="h-1 w-7 rounded bg-muted-foreground/70" />
        <div className="h-1 w-5 rounded bg-muted" />
      </div>
    </div>
  );
}

export function DocumentCardPreview(
  props: Record<string, unknown>,
): React.ReactElement {
  const title = typeof props.title === 'string' ? props.title : 'Document';
  const description =
    typeof props.description === 'string' ? props.description : '';
  return (
    <div
      className="flex items-center gap-3 rounded border border-border bg-background p-3"
      data-testid="preview-document-card"
    >
      <FileText className="size-10 text-muted-foreground" />
      <div className="flex flex-col">
        <div className="text-sm font-semibold">{title}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
    </div>
  );
}
