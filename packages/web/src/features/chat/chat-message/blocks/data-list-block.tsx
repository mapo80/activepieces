import {
  DataListBlock as DataListBlockType,
  DataListColumn,
  DataListItem,
} from '@activepieces/shared';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface Props {
  block: DataListBlockType;
  onPick?: (payload: string) => void;
}

interface LayoutProps {
  block: DataListBlockType;
  selected: string | null;
  onPick: (item: DataListItem) => void;
}

interface TableLayoutProps extends LayoutProps {
  columns: DataListColumn[];
}

export const DataListBlock: React.FC<Props> = ({ block, onPick }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const handlePick = (item: DataListItem) => {
    if (selected !== null || item.disabled) return;
    setSelected(item.payload);
    onPick?.(item.payload);
  };

  if (block.layout === 'single-confirm' && block.items.length === 1) {
    return (
      <SingleConfirmLayout
        block={block}
        confirmed={selected !== null}
        onConfirm={() => handlePick(block.items[0])}
      />
    );
  }

  if (
    block.layout === 'table' &&
    block.columns !== undefined &&
    block.columns.length > 0
  ) {
    return (
      <TableLayout
        block={block}
        columns={block.columns}
        selected={selected}
        onPick={handlePick}
      />
    );
  }

  return <CardsLayout block={block} selected={selected} onPick={handlePick} />;
};

const SingleConfirmLayout: React.FC<{
  block: DataListBlockType;
  confirmed: boolean;
  onConfirm: () => void;
}> = ({ block, confirmed, onConfirm }) => {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const item = block.items[0];
  const title = item.title ?? item.primary;
  const primary = item.title ? item.primary : undefined;
  return (
    <div
      data-testid="single-confirm-block"
      className="my-1 overflow-hidden rounded-md border border-border p-3 flex flex-col gap-2"
    >
      <div className="flex flex-col">
        <span className="font-medium text-foreground">{title}</span>
        {primary && (
          <span className="text-sm text-muted-foreground">{primary}</span>
        )}
        {item.subtitle && (
          <span className="text-xs text-muted-foreground">{item.subtitle}</span>
        )}
      </div>
      {dismissed ? (
        <div className="text-xs text-muted-foreground">
          {t('Type your answer below.')}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={confirmed}
            onClick={onConfirm}
            data-testid="single-confirm-yes"
            className={cn(
              'px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
              confirmed && 'opacity-60 cursor-default',
            )}
          >
            {t('Yes')}
          </button>
          <button
            type="button"
            disabled={confirmed}
            onClick={() => setDismissed(true)}
            data-testid="single-confirm-no"
            className={cn(
              'px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted transition-colors',
              confirmed && 'opacity-60 cursor-default',
            )}
          >
            {t('No')}
          </button>
        </div>
      )}
    </div>
  );
};

const CardsLayout: React.FC<LayoutProps> = ({ block, selected, onPick }) => (
  <div
    role="listbox"
    aria-label="Seleziona un'opzione"
    className="my-1 overflow-hidden rounded-md border border-border divide-y divide-border"
  >
    {block.items.map((item) => {
      const isSelected = selected === item.payload;
      const isDisabled = item.disabled || (selected !== null && !isSelected);
      return (
        <button
          key={item.payload}
          role="option"
          aria-selected={isSelected}
          disabled={isDisabled}
          onClick={() => onPick(item)}
          className={cn(
            'w-full text-left px-3 py-2 hover:bg-muted focus:bg-muted focus:outline-none transition-colors',
            isSelected && 'bg-primary/10',
            isDisabled && 'opacity-50 cursor-not-allowed',
            !isDisabled && !isSelected && 'cursor-pointer',
          )}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{item.primary}</span>
            {item.title && (
              <span className="text-sm text-muted-foreground">
                — {item.title}
              </span>
            )}
          </div>
          {item.subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {item.subtitle}
            </div>
          )}
          {item.metadata && item.metadata.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {item.metadata.map((m) => (
                <span key={m.label}>
                  <span className="font-medium">{m.label}:</span> {m.value}
                </span>
              ))}
            </div>
          )}
        </button>
      );
    })}
  </div>
);

const TableLayout: React.FC<TableLayoutProps> = ({
  block,
  columns,
  selected,
  onPick,
}) => (
  <div
    role="listbox"
    aria-label="Seleziona una riga"
    className="my-1 overflow-x-auto rounded-md border border-border"
  >
    <table className="w-full text-sm">
      <thead className="bg-muted">
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={cn(
                'px-3 py-2 text-left font-medium text-foreground',
                col.align === 'right' && 'text-right',
                col.align === 'center' && 'text-center',
              )}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {block.items.map((item) => {
          const isSelected = selected === item.payload;
          const isDisabled =
            item.disabled || (selected !== null && !isSelected);
          const handleActivate = () => {
            if (!isDisabled) onPick(item);
          };
          return (
            <tr
              key={item.payload}
              role="option"
              aria-selected={isSelected}
              aria-disabled={isDisabled || undefined}
              tabIndex={isDisabled ? -1 : 0}
              onClick={handleActivate}
              onKeyDown={(e) => {
                if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleActivate();
                }
              }}
              className={cn(
                'transition-colors',
                isSelected && 'bg-primary/10',
                !isDisabled &&
                  !isSelected &&
                  'cursor-pointer hover:bg-primary/5 focus:bg-primary/5 focus:outline-none',
                isDisabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-2 align-top',
                    col.align === 'right' && 'text-right tabular-nums',
                    col.align === 'center' && 'text-center',
                  )}
                >
                  {item.fields?.[col.key] ?? ''}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
