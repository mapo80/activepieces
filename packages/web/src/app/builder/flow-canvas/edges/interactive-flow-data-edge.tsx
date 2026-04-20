import { BaseEdge, EdgeProps } from '@xyflow/react';
import React from 'react';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowDataEdge } from '../utils/types';

export const ApInteractiveFlowDataCanvasEdge = ({
  sourceX,
  sourceY,
  targetY,
  data,
}: EdgeProps & ApInteractiveFlowDataEdge): React.ReactElement => {
  const lineLength = targetY - sourceY;
  const path = `M ${sourceX} ${sourceY} v${lineLength} ${flowCanvasConsts.ARROW_DOWN}`;
  const label = data.fieldName ?? data.branchName;
  const labelY = sourceY + lineLength / 2;

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          strokeWidth: `${flowCanvasConsts.LINE_WIDTH}px`,
          strokeDasharray: data.branchName ? '4 2' : undefined,
        }}
      />
      {label && (
        <foreignObject
          x={sourceX + 6}
          y={labelY - flowCanvasConsts.LABEL_HEIGHT / 2}
          width={140}
          height={flowCanvasConsts.LABEL_HEIGHT}
          className="overflow-visible"
        >
          <span
            className="inline-block rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm"
            data-testid="interactive-flow-edge-label"
          >
            {label}
          </span>
        </foreignObject>
      )}
    </>
  );
};
