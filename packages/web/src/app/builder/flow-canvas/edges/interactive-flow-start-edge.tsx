import { BaseEdge, EdgeProps } from '@xyflow/react';
import React from 'react';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowStartEdge } from '../utils/types';

export const ApInteractiveFlowStartCanvasEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps & ApInteractiveFlowStartEdge): React.ReactElement => {
  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const path =
    Math.abs(deltaX) < 1
      ? `M ${sourceX} ${sourceY} v ${deltaY} ${flowCanvasConsts.ARROW_DOWN}`
      : `M ${sourceX} ${sourceY} v ${deltaY / 2} h ${deltaX} v ${deltaY / 2} ${
          flowCanvasConsts.ARROW_DOWN
        }`;
  return (
    <BaseEdge
      path={path}
      style={{ strokeWidth: `${flowCanvasConsts.LINE_WIDTH}px` }}
    />
  );
};
