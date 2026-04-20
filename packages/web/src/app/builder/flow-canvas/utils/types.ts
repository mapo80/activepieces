import {
  FlowAction,
  StepLocationRelativeToParent,
  FlowTrigger,
  InteractiveFlowNode,
  InteractiveFlowPhase,
  Note,
} from '@activepieces/shared';
import { Edge } from '@xyflow/react';

export enum ApNodeType {
  STEP = 'STEP',
  ADD_BUTTON = 'ADD_BUTTON',
  BIG_ADD_BUTTON = 'BIG_ADD_BUTTON',
  GRAPH_END_WIDGET = 'GRAPH_END_WIDGET',
  GRAPH_START_WIDGET = 'GRAPH_START_WIDGET',
  /**Used for calculating the loop graph width */
  LOOP_RETURN_NODE = 'LOOP_RETURN_NODE',
  /**Used for calculating the interactive flow graph width */
  INTERACTIVE_FLOW_RETURN_NODE = 'INTERACTIVE_FLOW_RETURN_NODE',
  /**Child node for an interactive-flow action (TOOL, USER_INPUT, CONFIRM, BRANCH) */
  INTERACTIVE_FLOW_CHILD = 'INTERACTIVE_FLOW_CHILD',
  /**Dashed container around the interactive-flow subgraph */
  INTERACTIVE_FLOW_CONTAINER = 'INTERACTIVE_FLOW_CONTAINER',
  NOTE = 'NOTE',
}
export type ApBoundingBox = {
  width: number;
  height: number;
  left: number;
  right: number;
};

export type ApStepNode = {
  id: string;
  type: ApNodeType.STEP;
  position: {
    x: number;
    y: number;
  };
  data: {
    step: FlowAction | FlowTrigger;
  };
  selectable?: boolean;
  style?: React.CSSProperties;
  draggable?: boolean;
};

export type ApNoteNode = {
  id: string;
  type: ApNodeType.NOTE;
  position: {
    x: number;
    y: number;
  };
  data: Pick<Note, 'content' | 'ownerId' | 'color' | 'size'>;
};

export type ApLoopReturnNode = {
  id: string;
  type: ApNodeType.LOOP_RETURN_NODE;
  position: {
    x: number;
    y: number;
  };
  data: Record<string, never>;
  selectable?: boolean;
};

export type ApButtonData = {
  edgeId: string;
} & (
  | {
      parentStepName: string;
      stepLocationRelativeToParent:
        | StepLocationRelativeToParent.AFTER
        | StepLocationRelativeToParent.INSIDE_LOOP
        | StepLocationRelativeToParent.INSIDE_INTERACTIVE_FLOW;
    }
  | {
      parentStepName: string;
      stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH;
      branchIndex: number;
    }
);

export type ApBigAddButtonNode = {
  id: string;
  type: ApNodeType.BIG_ADD_BUTTON;
  position: {
    x: number;
    y: number;
  };
  data: ApButtonData;
  selectable?: boolean;
  style?: React.CSSProperties;
};

export type ApGraphEndNode = {
  id: string;
  type: ApNodeType.GRAPH_END_WIDGET;
  position: {
    x: number;
    y: number;
  };
  data: {
    showWidget?: boolean;
  };
  selectable?: boolean;
};

export type ApInteractiveFlowReturnNode = {
  id: string;
  type: ApNodeType.INTERACTIVE_FLOW_RETURN_NODE;
  position: {
    x: number;
    y: number;
  };
  data: Record<string, never>;
  selectable?: boolean;
};

export type ApInteractiveFlowChildNode = {
  id: string;
  type: ApNodeType.INTERACTIVE_FLOW_CHILD;
  position: {
    x: number;
    y: number;
  };
  data: {
    parentStepName: string;
    node: InteractiveFlowNode;
    hasDrift?: boolean;
    isExtractorTarget?: boolean;
    phaseId?: string;
    phases?: InteractiveFlowPhase[];
  };
  selectable?: boolean;
  zIndex?: number;
};

export type ApInteractiveFlowContainerNode = {
  id: string;
  type: ApNodeType.INTERACTIVE_FLOW_CONTAINER;
  position: {
    x: number;
    y: number;
  };
  data: {
    parentStepName: string;
    parentDisplayName: string;
    width: number;
    height: number;
  };
  selectable?: boolean;
  draggable?: boolean;
  zIndex?: number;
};

export type ApNode =
  | ApStepNode
  | ApGraphEndNode
  | ApBigAddButtonNode
  | ApLoopReturnNode
  | ApInteractiveFlowReturnNode
  | ApInteractiveFlowChildNode
  | ApInteractiveFlowContainerNode
  | ApNoteNode;

export enum ApEdgeType {
  STRAIGHT_LINE = 'ApStraightLineEdge',
  LOOP_START_EDGE = 'ApLoopStartEdge',
  LOOP_CLOSE_EDGE = 'ApLoopCloseEdge',
  LOOP_RETURN_EDGE = 'ApLoopReturnEdge',
  ROUTER_START_EDGE = 'ApRouterStartEdge',
  ROUTER_END_EDGE = 'ApRouterEndEdge',
  INTERACTIVE_FLOW_DATA_EDGE = 'ApInteractiveFlowDataEdge',
  INTERACTIVE_FLOW_START_EDGE = 'ApInteractiveFlowStartEdge',
  INTERACTIVE_FLOW_RETURN_EDGE = 'ApInteractiveFlowReturnEdge',
}

export type ApStraightLineEdge = Edge & {
  type: ApEdgeType.STRAIGHT_LINE;
  data: {
    drawArrowHead: boolean;
    hideAddButton?: boolean;
    parentStepName: string;
  };
};

export type ApLoopStartEdge = Edge & {
  type: ApEdgeType.LOOP_START_EDGE;
  data: {
    isLoopEmpty: boolean;
  };
};

export type ApLoopCloseEdge = Edge & {
  type: ApEdgeType.LOOP_CLOSE_EDGE;
};

export type ApLoopReturnEdge = Edge & {
  type: ApEdgeType.LOOP_RETURN_EDGE;
  data: {
    parentStepName: string;
    isLoopEmpty: boolean;
    drawArrowHeadAfterEnd: boolean;
    verticalSpaceBetweenReturnNodeStartAndEnd: number;
  };
};

export type ApRouterStartEdge = Edge & {
  type: ApEdgeType.ROUTER_START_EDGE;
  data: {
    isBranchEmpty: boolean;
    label: string;
    drawHorizontalLine: boolean;
    drawStartingVerticalLine: boolean;
  } & {
    stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_BRANCH;
    branchIndex: number;
  };
};

export type ApRouterEndEdge = Edge & {
  type: ApEdgeType.ROUTER_END_EDGE;
  data: {
    drawHorizontalLine: boolean;
    verticalSpaceBetweenLastNodeInBranchAndEndLine: number;
  } & (
    | {
        routerOrBranchStepName: string;
        drawEndingVerticalLine: true;
        isNextStepEmpty: boolean;
      }
    | {
        drawEndingVerticalLine: false;
      }
  );
};

export type ApInteractiveFlowDataEdge = Edge & {
  type: ApEdgeType.INTERACTIVE_FLOW_DATA_EDGE;
  data: {
    fieldNames: string[];
    branchName?: string;
    parentStepName: string;
    isSkipConnection?: boolean;
    sourceDisplayName?: string;
    targetDisplayName?: string;
  };
};

export type ApInteractiveFlowStartEdge = Edge & {
  type: ApEdgeType.INTERACTIVE_FLOW_START_EDGE;
  data: {
    parentStepName: string;
  };
};

export type ApInteractiveFlowReturnEdge = Edge & {
  type: ApEdgeType.INTERACTIVE_FLOW_RETURN_EDGE;
  data: {
    parentStepName: string;
    drawArrowHeadAfterEnd: boolean;
    carriesAddButton?: boolean;
  };
};

export type ApEdge =
  | ApLoopStartEdge
  | ApLoopReturnEdge
  | ApStraightLineEdge
  | ApRouterStartEdge
  | ApRouterEndEdge
  | ApInteractiveFlowDataEdge
  | ApInteractiveFlowStartEdge
  | ApInteractiveFlowReturnEdge;
export type ApGraph = {
  nodes: ApNode[];
  edges: ApEdge[];
};
