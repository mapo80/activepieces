import React from 'react';

export function DatePickerCardThumbnail(): React.ReactElement {
  return (
    <div
      className="flex h-10 w-16 flex-col gap-0.5 rounded border border-border bg-background p-1"
      data-testid="thumb-date-picker"
    >
      <div className="h-1 w-full rounded bg-muted-foreground/50" />
      <div className="mt-0.5 grid grid-cols-3 gap-0.5">
        <div className="h-1 rounded bg-muted" />
        <div className="h-1 rounded bg-muted" />
        <div className="h-1 rounded bg-muted" />
        <div className="h-1 rounded bg-muted" />
        <div className="h-1 rounded bg-primary" />
        <div className="h-1 rounded bg-muted" />
      </div>
    </div>
  );
}

export function DatePickerCardPreview(
  props: Record<string, unknown>,
): React.ReactElement {
  const format = typeof props.format === 'string' ? props.format : 'YYYY-MM-DD';
  const value =
    typeof (props as { date?: string }).date === 'string'
      ? (props as { date: string }).date
      : new Date().toISOString().slice(0, 10);
  return (
    <div
      className="flex flex-col gap-2 rounded border border-border bg-background p-3"
      data-testid="preview-date-picker"
    >
      <div className="text-sm font-medium">{format}</div>
      <input
        type="date"
        className="rounded border border-border bg-background p-2 text-sm"
        value={value}
        readOnly
      />
    </div>
  );
}
