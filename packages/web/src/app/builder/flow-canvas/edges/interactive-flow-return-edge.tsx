import { BaseEdge, EdgeProps } from '@xyflow/react';
import React from 'react';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowReturnEdge } from '../utils/types';

export const ApInteractiveFlowReturnCanvasEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps & ApInteractiveFlowReturnEdge): React.ReactElement => {
  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const path =
    Math.abs(deltaX) < 1
      ? `M ${sourceX} ${sourceY} v ${deltaY} ${
          data.drawArrowHeadAfterEnd ? flowCanvasConsts.ARROW_DOWN : ''
        }`
      : `M ${sourceX} ${sourceY} v ${deltaY / 2} h ${deltaX} v ${deltaY / 2} ${
          data.drawArrowHeadAfterEnd ? flowCanvasConsts.ARROW_DOWN : ''
        }`;
  return (
    <BaseEdge
      path={path}
      style={{ strokeWidth: `${flowCanvasConsts.LINE_WIDTH}px` }}
    />
  );
};
