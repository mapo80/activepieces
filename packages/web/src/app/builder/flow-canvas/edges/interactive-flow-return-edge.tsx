import {
  FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
  FLOW_CANVAS_VSPACE,
  StepLocationRelativeToParent,
} from '@activepieces/shared';
import { BaseEdge, EdgeProps } from '@xyflow/react';
import React from 'react';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowReturnEdge } from '../utils/types';

import { ApAddButton } from './add-button';

export const ApInteractiveFlowReturnCanvasEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  id,
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
  const showAddButton = data.carriesAddButton === true;
  const addBtnWidth = flowCanvasConsts.AP_NODE_SIZE.ADD_BUTTON.width;
  const addBtnHeight = flowCanvasConsts.AP_NODE_SIZE.ADD_BUTTON.height;
  const addButtonY =
    targetY -
    FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT -
    FLOW_CANVAS_VSPACE / 2;
  return (
    <>
      <BaseEdge
        path={path}
        style={{ strokeWidth: `${flowCanvasConsts.LINE_WIDTH}px` }}
      />
      {showAddButton && (
        <foreignObject
          x={targetX - addBtnWidth / 2}
          y={addButtonY - addBtnHeight / 2}
          width={addBtnWidth}
          height={addBtnHeight}
          className="overflow-visible"
        >
          <ApAddButton
            edgeId={id}
            stepLocationRelativeToParent={StepLocationRelativeToParent.AFTER}
            parentStepName={data.parentStepName}
          />
        </foreignObject>
      )}
    </>
  );
};
