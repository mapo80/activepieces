import React from 'react';

export function TextInputThumbnail(): React.ReactElement {
  return (
    <div
      className="flex h-10 w-16 items-center rounded border border-border bg-background px-2"
      data-testid="thumb-text-input"
    >
      <div className="h-2 w-10 rounded bg-muted" />
    </div>
  );
}

export function TextInputPreview(
  props: Record<string, unknown>,
): React.ReactElement {
  const placeholder =
    typeof props.placeholder === 'string' ? props.placeholder : 'Type here…';
  const multiline = props.multiline === true;
  return (
    <div className="flex flex-col gap-2" data-testid="preview-text-input">
      {multiline ? (
        <textarea
          className="min-h-[80px] rounded border border-border bg-background p-2 text-sm"
          placeholder={placeholder}
          readOnly
        />
      ) : (
        <input
          type="text"
          className="rounded border border-border bg-background p-2 text-sm"
          placeholder={placeholder}
          readOnly
        />
      )}
    </div>
  );
}
