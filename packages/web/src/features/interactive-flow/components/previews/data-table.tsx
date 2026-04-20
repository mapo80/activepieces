import React from 'react';

type Column = { key: string; label: string };

export function DataTableThumbnail(): React.ReactElement {
  return (
    <div
      className="flex h-10 w-16 flex-col gap-0.5 rounded border border-border bg-background p-1"
      data-testid="thumb-data-table"
    >
      <div className="h-1 w-full rounded bg-muted-foreground/50" />
      <div className="h-1 w-full rounded bg-muted" />
      <div className="h-1 w-full rounded bg-muted" />
      <div className="h-1 w-full rounded bg-muted" />
    </div>
  );
}

export function DataTablePreview(
  props: Record<string, unknown>,
): React.ReactElement {
  const columns = (props.columns as Column[] | undefined) ?? [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
  ];
  const rows = (props as { rows?: Record<string, unknown>[] }).rows ?? [];
  const emptyText =
    typeof props.emptyText === 'string' ? props.emptyText : 'No rows';

  return (
    <div
      className="rounded border border-border bg-background"
      data-testid="preview-data-table"
    >
      <table className="w-full text-xs">
        <thead className="border-b border-border bg-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1 text-left font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-2 py-3 text-center text-muted-foreground"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx} className="border-b border-border">
                {columns.map((c) => (
                  <td key={c.key} className="px-2 py-1">
                    {String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
