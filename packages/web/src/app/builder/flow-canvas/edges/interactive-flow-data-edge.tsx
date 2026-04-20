import { BaseEdge, EdgeProps } from '@xyflow/react';
import { t } from 'i18next';
import React from 'react';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowDataEdge } from '../utils/types';

const DOT_SIZE = 10;
const HIT_AREA_SIZE = 16;

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
        <>
          <circle
            cx={midX}
            cy={midY}
            r={DOT_SIZE / 2}
            fill="var(--xy-edge-stroke, #b1b1b7)"
            stroke="hsl(var(--background))"
            strokeWidth={1.5}
            pointerEvents="none"
          />
          <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
              <foreignObject
                x={midX - HIT_AREA_SIZE / 2}
                y={midY - HIT_AREA_SIZE / 2}
                width={HIT_AREA_SIZE}
                height={HIT_AREA_SIZE}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={ariaLabel}
                  data-testid="interactive-flow-edge-dot"
                  className={cn(
                    'block size-full rounded-full border-0 bg-transparent p-0',
                    'focus:outline-none focus:ring-2 focus:ring-ring',
                  )}
                />
              </foreignObject>
            </HoverCardTrigger>
            <HoverCardContent
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
            </HoverCardContent>
          </HoverCard>
        </>
      ) : null}
    </>
  );
};
