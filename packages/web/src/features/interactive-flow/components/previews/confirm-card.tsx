import React from 'react';

export function ConfirmCardThumbnail(): React.ReactElement {
  return (
    <div
      className="flex h-10 w-16 flex-col justify-between rounded border border-border bg-background p-1"
      data-testid="thumb-confirm-card"
    >
      <div className="h-1 w-full rounded bg-muted-foreground/50" />
      <div className="flex gap-0.5">
        <div className="h-2 flex-1 rounded bg-muted" />
        <div className="h-2 flex-1 rounded bg-primary" />
      </div>
    </div>
  );
}

export function ConfirmCardPreview(
  props: Record<string, unknown>,
): React.ReactElement {
  const title =
    typeof props.title === 'string' ? props.title : 'Please confirm';
  const confirmLabel =
    typeof props.confirmLabel === 'string' ? props.confirmLabel : 'Confirm';
  const cancelLabel =
    typeof props.cancelLabel === 'string' ? props.cancelLabel : 'Cancel';
  const state = (props as { state?: Record<string, unknown> }).state ?? {};
  return (
    <div
      className="flex flex-col gap-3 rounded border border-border bg-background p-3"
      data-testid="preview-confirm-card"
    >
      <div className="text-sm font-semibold">{title}</div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 text-xs">
        {Object.entries(state).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="font-medium text-muted-foreground">{k}</dt>
            <dd className="truncate">{String(v ?? '')}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-xs"
          disabled
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
          disabled
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
