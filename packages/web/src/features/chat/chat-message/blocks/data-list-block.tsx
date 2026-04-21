import { DataListBlock as DataListBlockType } from '@activepieces/shared';
import React, { useState } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  block: DataListBlockType;
  onPick?: (payload: string) => void;
}

export const DataListBlock: React.FC<Props> = ({ block, onPick }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const handlePick = (item: DataListBlockType['items'][number]) => {
    if (selected !== null || item.disabled) return;
    setSelected(item.primary);
    onPick?.(item.payload);
  };

  return (
    <div
      role="listbox"
      aria-label="Seleziona un'opzione"
      className="my-1 overflow-hidden rounded-md border border-border divide-y divide-border"
    >
      {block.items.map((item) => {
        const isSelected = selected === item.primary;
        const isDisabled = item.disabled || (selected !== null && !isSelected);
        return (
          <button
            key={item.primary}
            role="option"
            aria-selected={isSelected}
            disabled={isDisabled}
            onClick={() => handlePick(item)}
            className={cn(
              'w-full text-left px-3 py-2 hover:bg-muted focus:bg-muted focus:outline-none transition-colors',
              isSelected && 'bg-primary/10',
              isDisabled && 'opacity-50 cursor-not-allowed',
              !isDisabled && !isSelected && 'cursor-pointer',
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-foreground">{item.primary}</span>
              <span className="text-sm text-muted-foreground">— {item.title}</span>
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
};
