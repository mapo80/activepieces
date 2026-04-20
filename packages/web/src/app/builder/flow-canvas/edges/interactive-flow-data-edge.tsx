import { BaseEdge, EdgeProps } from '@xyflow/react';
import { t } from 'i18next';
import React from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowDataEdge } from '../utils/types';

const DOT_SIZE = 12;

export const ApInteractiveFlowDataCanvasEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps & ApInteractiveFlowDataEdge): React.ReactElement => {
  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const midX = sourceX + deltaX / 2;
  const midY = sourceY + deltaY / 2;
  const path =
    Math.abs(deltaX) < 1
      ? `M ${sourceX} ${sourceY} v ${deltaY} ${flowCanvasConsts.ARROW_DOWN}`
      : `M ${sourceX} ${sourceY} v ${deltaY / 2} h ${deltaX} v ${deltaY / 2} ${
          flowCanvasConsts.ARROW_DOWN
        }`;
  const isBranch = !!data.branchName;
  const isSkip = !!data.isSkipConnection;
  const fieldNames = data.fieldNames ?? [];
  const hasFields = fieldNames.length > 0;
  const sourceDisplay = data.sourceDisplayName ?? '';
  const targetDisplay = data.targetDisplayName ?? '';
  const ariaLabel = t('Data flow {{fields}} from {{source}} to {{target}}', {
    fields: fieldNames.join(', '),
    source: sourceDisplay,
    target: targetDisplay,
  });

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          strokeWidth: `${flowCanvasConsts.LINE_WIDTH}px`,
          strokeDasharray: isBranch ? '4 2' : isSkip ? '2 3' : undefined,
          opacity: isSkip && !isBranch ? 0.6 : 1,
        }}
      />
      {isBranch ? (
        <foreignObject
          x={midX + 6}
          y={midY - flowCanvasConsts.LABEL_HEIGHT / 2}
          width={140}
          height={flowCanvasConsts.LABEL_HEIGHT}
          className="overflow-visible"
        >
          <span
            className="inline-block rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm"
            data-testid="interactive-flow-edge-label"
          >
            {data.branchName}
          </span>
        </foreignObject>
      ) : hasFields ? (
        <foreignObject
          x={midX - DOT_SIZE / 2}
          y={midY - DOT_SIZE / 2}
          width={DOT_SIZE}
          height={DOT_SIZE}
          className="overflow-visible"
        >
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={ariaLabel}
                data-testid="interactive-flow-edge-dot"
                className={cn(
                  'size-3 rounded-full border border-background bg-foreground transition-transform',
                  'hover:scale-125 focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              />
            </PopoverTrigger>
            <PopoverContent
              className="w-auto max-w-sm p-3 text-xs"
              align="center"
              role="dialog"
            >
              <div className="mb-2 flex items-center gap-1 text-muted-foreground">
                <span className="font-semibold">{sourceDisplay}</span>
                <span aria-hidden>→</span>
                <span className="font-semibold">{targetDisplay}</span>
              </div>
              <div className="space-y-1">
                {fieldNames.map((f) => (
                  <div
                    key={f}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {f}
                  </div>
                ))}
              </div>
              {isSkip && (
                <div className="mt-2 text-[10px] italic text-muted-foreground">
                  {t('skip connection')}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </foreignObject>
      ) : null}
    </>
  );
};
