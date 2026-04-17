import { Handle, Position } from '@xyflow/react';

import { flowCanvasConsts } from '../utils/consts';

const ApInteractiveFlowReturnCanvasNode = () => {
  return (
    <>
      <div
        className="h-px bg-transparent pointer-events-none"
        style={{
          width:
            flowCanvasConsts.AP_NODE_SIZE.INTERACTIVE_FLOW_RETURN_NODE.width,
        }}
      ></div>
      <Handle
        type="source"
        position={Position.Top}
        style={flowCanvasConsts.HANDLE_STYLING}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        style={flowCanvasConsts.HANDLE_STYLING}
      />
    </>
  );
};

ApInteractiveFlowReturnCanvasNode.displayName =
  'ApInteractiveFlowReturnCanvasNode';
export default ApInteractiveFlowReturnCanvasNode;
