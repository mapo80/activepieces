import { DatePickerBlock as DatePickerBlockType } from '@activepieces/shared';
import { format as fmtFns } from 'date-fns';
import { enUS, it } from 'date-fns/locale';
import React, { useState } from 'react';
import type { Matcher } from 'react-day-picker';

import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

interface Props {
  block: DatePickerBlockType;
  onPick?: (payload: string) => void;
}

export const DatePickerBlock: React.FC<Props> = ({ block, onPick }) => {
  const [selected, setSelected] = useState<Date | null>(null);
  const picked = selected !== null;

  const startOfDay = (d: Date): Date => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const minDate =
    block.minDate === 'today'
      ? startOfDay(new Date())
      : block.minDate
      ? new Date(block.minDate)
      : undefined;
  const maxDate = block.maxDate ? new Date(block.maxDate) : undefined;

  const localeObj = block.locale?.startsWith('it') ? it : enUS;

  const disabledMatchers: Matcher[] = picked
    ? [() => true]
    : [
        ...(minDate ? [{ before: minDate } as const] : []),
        ...(maxDate ? [{ after: maxDate } as const] : []),
      ];

  const handleSelect = (d: Date | undefined) => {
    if (!d || picked) return;
    setSelected(d);
    const payload =
      block.format === 'DD/MM/YYYY'
        ? fmtFns(d, 'dd/MM/yyyy')
        : block.format === 'ISO'
        ? d.toISOString()
        : fmtFns(d, 'yyyy-MM-dd');
    onPick?.(payload);
  };

  return (
    <div className="my-1 w-fit max-w-full self-start rounded-md border border-border bg-background p-2">
      {block.title && (
        <div className="px-2 pb-2 text-sm font-medium">{block.title}</div>
      )}
      <Calendar
        mode="single"
        selected={selected ?? undefined}
        onSelect={handleSelect}
        disabled={disabledMatchers}
        locale={localeObj}
        className={cn(picked && 'pointer-events-none opacity-80')}
      />
      {picked && (
        <div className="px-2 pt-2 text-sm text-muted-foreground">
          Data selezionata:{' '}
          <span className="font-medium text-foreground">
            {fmtFns(selected!, 'dd/MM/yyyy')}
          </span>
        </div>
      )}
    </div>
  );
};
