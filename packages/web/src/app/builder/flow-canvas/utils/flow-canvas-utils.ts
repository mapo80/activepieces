import {
  FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
  FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING,
  FLOW_CANVAS_VSPACE,
  FlowAction,
  FlowActionType,
  FlowOperationType,
  FlowRun,
  flowStructureUtil,
  FlowVersion,
  InteractiveFlowBranchNode,
  InteractiveFlowNode,
  InteractiveFlowNodeType,
  InteractiveFlowPhase,
  isNil,
  LoopOnItemsAction,
  RouterAction,
  StepLocationRelativeToParent,
  FlowTrigger,
  FlowTriggerType,
  InteractiveFlowAction,
  Note,
} from '@activepieces/shared';
import { t } from 'i18next';

import { flowRunUtils } from '@/features/flow-runs';
import { NEW_FLOW_QUERY_PARAM } from '@/lib/route-utils';

import { flowCanvasConsts } from './consts';
import {
  ApBigAddButtonNode,
  ApButtonData,
  ApEdge,
  ApEdgeType,
  ApGraph,
  ApGraphEndNode,
  ApInteractiveFlowChildNode,
  ApInteractiveFlowContainerNode,
  ApInteractiveFlowDataEdge,
  ApInteractiveFlowReturnEdge,
  ApInteractiveFlowStartEdge,
  ApLoopReturnNode,
  ApNode,
  ApNodeType,
  ApStepNode,
  ApStraightLineEdge,
} from './types';

const createBigAddButtonGraph: (
  parentStep: LoopOnItemsAction | RouterAction | InteractiveFlowAction,
  nodeData: ApBigAddButtonNode['data'],
) => ApGraph = (parentStep, nodeData) => {
  const bigAddButtonNode: ApBigAddButtonNode = {
    id: `${parentStep.name}-big-add-button-${nodeData.edgeId}`,
    type: ApNodeType.BIG_ADD_BUTTON,
    position: { x: 0, y: 0 },
    data: nodeData,
    selectable: false,
    style: {
      pointerEvents: 'all',
    },
  };
  const graphEndNode: ApGraphEndNode = {
    id: `${parentStep.name}-subgraph-end-${nodeData.edgeId}`,
    type: ApNodeType.GRAPH_END_WIDGET as const,
    position: {
      x: flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
      y:
        flowCanvasConsts.AP_NODE_SIZE.STEP.height +
        flowCanvasConsts.VERTICAL_SPACE_BETWEEN_STEPS,
    },
    data: {},
    selectable: false,
  };

  const straightLineEdge: ApStraightLineEdge = {
    id: `big-button-straight-line-for${nodeData.edgeId}`,
    source: `${parentStep.name}-big-add-button-${nodeData.edgeId}`,
    target: `${parentStep.name}-subgraph-end-${nodeData.edgeId}`,
    type: ApEdgeType.STRAIGHT_LINE as const,
    data: {
      drawArrowHead: false,
      hideAddButton: true,
      parentStepName: parentStep.name,
    },
  };
  return {
    nodes: [bigAddButtonNode, graphEndNode],
    edges: [straightLineEdge],
  };
};

const createStepGraph: (
  step: FlowAction | FlowTrigger,
  graphHeight: number,
) => ApGraph = (step, graphHeight) => {
  const stepNode: ApStepNode = {
    id: step.name,
    type: ApNodeType.STEP as const,
    position: { x: 0, y: 0 },
    data: {
      step,
    },
    selectable: step.name !== 'trigger',
    draggable: true,
    style: {
      pointerEvents: 'all',
    },
  };

  const graphEndNode: ApGraphEndNode = {
    id: `${step.name}-subgraph-end`,
    type: ApNodeType.GRAPH_END_WIDGET as const,
    position: {
      x: flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
      y: graphHeight,
    },
    data: {},
    selectable: false,
  };

  const straightLineEdge: ApStraightLineEdge = {
    id: `${step.name}-${step.nextAction?.name ?? 'graph-end'}-edge`,
    source: step.name,
    target: `${step.name}-subgraph-end`,
    type: ApEdgeType.STRAIGHT_LINE as const,
    data: {
      drawArrowHead: !isNil(step.nextAction),
      parentStepName: step.name,
    },
  };
  return {
    nodes: [stepNode, graphEndNode],
    edges:
      step.type !== FlowActionType.LOOP_ON_ITEMS &&
      step.type !== FlowActionType.ROUTER
        ? [straightLineEdge]
        : [],
  };
};

const buildFlowGraph: (
  step: FlowAction | FlowTrigger | undefined,
) => ApGraph = (step) => {
  if (isNil(step)) {
    return {
      nodes: [],
      edges: [],
    };
  }

  const graph: ApGraph = createStepGraph(
    step,
    flowCanvasConsts.AP_NODE_SIZE.STEP.height +
      flowCanvasConsts.VERTICAL_SPACE_BETWEEN_STEPS,
  );
  const childGraph =
    step.type === FlowActionType.LOOP_ON_ITEMS
      ? buildLoopChildGraph(step)
      : step.type === FlowActionType.ROUTER
      ? buildRouterChildGraph(step)
      : step.type === FlowActionType.INTERACTIVE_FLOW
      ? buildInteractiveFlowChildGraph(step)
      : null;

  const graphWithChild = childGraph ? mergeGraph(graph, childGraph) : graph;
  const nextStepGraph = buildFlowGraph(step.nextAction);
  return mergeGraph(
    graphWithChild,
    offsetGraph(nextStepGraph, {
      x: 0,
      y: calculateGraphBoundingBox(graphWithChild).height,
    }),
  );
};

function offsetGraph(
  graph: ApGraph,
  offset: { x: number; y: number },
): ApGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      zIndex: 50,
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      zIndex: 50,
    })),
  };
}

function mergeGraph(graph1: ApGraph, graph2: ApGraph): ApGraph {
  return {
    nodes: [...graph1.nodes, ...graph2.nodes],
    edges: [...graph1.edges, ...graph2.edges],
  };
}

function createFocusStepInGraphParams(stepName: string) {
  return {
    nodes: [{ id: stepName }],
    duration: 1000,
    maxZoom: 1.25,
    minZoom: 1.25,
  };
}

const calculateGraphBoundingBox = (graph: ApGraph) => {
  const affectingNodes = graph.nodes.filter((node) =>
    flowCanvasConsts.doesNodeAffectBoundingBox(node.type),
  );
  const minX = Math.min(...affectingNodes.map((node) => node.position.x));
  const minY = Math.min(...affectingNodes.map((node) => node.position.y));
  const maxX = Math.max(
    ...affectingNodes.map(
      (node) => node.position.x + flowCanvasConsts.AP_NODE_SIZE.STEP.width,
    ),
  );
  const maxY = Math.max(...affectingNodes.map((node) => node.position.y));
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    width,
    height,
    left: -minX + flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
    right: maxX - flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
    top: minY,
    bottom: maxY,
  };
};

const buildLoopChildGraph: (step: LoopOnItemsAction) => ApGraph = (step) => {
  const childGraph = step.firstLoopAction
    ? buildFlowGraph(step.firstLoopAction)
    : createBigAddButtonGraph(step, {
        parentStepName: step.name,
        stepLocationRelativeToParent: StepLocationRelativeToParent.INSIDE_LOOP,
        edgeId: `${step.name}-loop-start-edge`,
      });

  const childGraphBoundingBox = calculateGraphBoundingBox(childGraph);
  const deltaLeftX =
    -(
      childGraphBoundingBox.width +
      flowCanvasConsts.AP_NODE_SIZE.STEP.width +
      flowCanvasConsts.HORIZONTAL_SPACE_BETWEEN_NODES -
      flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2 -
      childGraphBoundingBox.right
    ) /
      2 -
    flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2;

  const loopReturnNode: ApLoopReturnNode = {
    id: `${step.name}-loop-return-node`,
    type: ApNodeType.LOOP_RETURN_NODE,
    position: {
      x: deltaLeftX + flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
      y:
        flowCanvasConsts.AP_NODE_SIZE.STEP.height +
        flowCanvasConsts.VERTICAL_OFFSET_BETWEEN_LOOP_AND_CHILD +
        childGraphBoundingBox.height / 2,
    },
    data: {},
    selectable: false,
  };
  const childGraphAfterOffset = offsetGraph(childGraph, {
    x:
      deltaLeftX +
      flowCanvasConsts.AP_NODE_SIZE.STEP.width +
      flowCanvasConsts.HORIZONTAL_SPACE_BETWEEN_NODES +
      childGraphBoundingBox.left,
    y:
      flowCanvasConsts.VERTICAL_OFFSET_BETWEEN_LOOP_AND_CHILD +
      flowCanvasConsts.AP_NODE_SIZE.STEP.height,
  });
  const edges: ApEdge[] = [
    {
      id: `${step.name}-loop-start-edge`,
      source: step.name,
      target: `${childGraph.nodes[0].id}`,
      type: ApEdgeType.LOOP_START_EDGE as const,
      data: {
        isLoopEmpty: isNil(step.firstLoopAction),
      },
    },
    {
      id: `${step.name}-loop-return-node`,
      source: `${childGraph.nodes[childGraph.nodes.length - 1].id}`,
      target: `${step.name}-loop-return-node`,
      type: ApEdgeType.LOOP_RETURN_EDGE as const,
      data: {
        parentStepName: step.name,
        isLoopEmpty: isNil(step.firstLoopAction),
        drawArrowHeadAfterEnd: !isNil(step.nextAction),
        verticalSpaceBetweenReturnNodeStartAndEnd:
          childGraphBoundingBox.height +
          flowCanvasConsts.VERTICAL_SPACE_BETWEEN_STEPS,
      },
    },
  ];

  const subgraphEndSubNode: ApGraphEndNode = {
    id: `${step.name}-loop-subgraph-end`,
    type: ApNodeType.GRAPH_END_WIDGET,
    position: {
      x: flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
      y:
        flowCanvasConsts.AP_NODE_SIZE.STEP.height +
        flowCanvasConsts.VERTICAL_OFFSET_BETWEEN_LOOP_AND_CHILD +
        childGraphBoundingBox.height +
        flowCanvasConsts.ARC_LENGTH +
        flowCanvasConsts.VERTICAL_SPACE_BETWEEN_STEPS,
    },
    data: {},
    selectable: false,
  };

  return {
    nodes: [loopReturnNode, ...childGraphAfterOffset.nodes, subgraphEndSubNode],
    edges: [...edges, ...childGraphAfterOffset.edges],
  };
};

const buildRouterChildGraph = (step: RouterAction) => {
  const childGraphs = step.children.map((branch, index) => {
    return branch
      ? buildFlowGraph(branch)
      : createBigAddButtonGraph(step, {
          parentStepName: step.name,
          stepLocationRelativeToParent:
            StepLocationRelativeToParent.INSIDE_BRANCH,
          branchIndex: index,
          edgeId: `${step.name}-branch-${index}-start-edge`,
        });
  });

  const childGraphsAfterOffset = offsetRouterChildSteps(childGraphs);

  const maxHeight = Math.max(
    ...childGraphsAfterOffset.map((cg) => calculateGraphBoundingBox(cg).height),
  );

  const subgraphEndSubNode: ApGraphEndNode = {
    id: `${step.name}-branch-subgraph-end`,
    type: ApNodeType.GRAPH_END_WIDGET,
    position: {
      x: flowCanvasConsts.AP_NODE_SIZE.STEP.width / 2,
      y:
        flowCanvasConsts.AP_NODE_SIZE.STEP.height +
        flowCanvasConsts.VERTICAL_OFFSET_BETWEEN_ROUTER_AND_CHILD +
        maxHeight +
        flowCanvasConsts.ARC_LENGTH +
        flowCanvasConsts.VERTICAL_SPACE_BETWEEN_STEPS,
    },
    data: {},
    selectable: false,
  };
  const edges: ApEdge[] = childGraphsAfterOffset
    .map((childGraph, branchIndex) => {
      return [
        {
          id: `${step.name}-branch-${branchIndex}-start-edge`,
          source: step.name,
          target: `${childGraph.nodes[0].id}`,
          type: ApEdgeType.ROUTER_START_EDGE as const,
          data: {
            isBranchEmpty: isNil(step.children[branchIndex]),
            label:
              step.settings.branches[branchIndex]?.branchName ??
              `${t('Branch')} ${branchIndex + 1} (missing branch)`,
            branchIndex,
            stepLocationRelativeToParent:
              StepLocationRelativeToParent.INSIDE_BRANCH as const,
            drawHorizontalLine:
              branchIndex === 0 ||
              branchIndex === childGraphsAfterOffset.length - 1,
            drawStartingVerticalLine: branchIndex === 0,
          },
        },
        {
          id: `${step.name}-branch-${branchIndex}-end-edge`,
          source: `${childGraph.nodes.at(-1)!.id}`,
          target: subgraphEndSubNode.id,
          type: ApEdgeType.ROUTER_END_EDGE as const,
          data: {
            drawEndingVerticalLine: branchIndex === 0,
            verticalSpaceBetweenLastNodeInBranchAndEndLine:
              subgraphEndSubNode.position.y -
              childGraph.nodes.at(-1)!.position.y -
              flowCanvasConsts.VERTICAL_SPACE_BETWEEN_STEPS -
              flowCanvasConsts.ARC_LENGTH,
            drawHorizontalLine:
              branchIndex === 0 ||
              branchIndex === childGraphsAfterOffset.length - 1,
            routerOrBranchStepName: step.name,
            isNextStepEmpty: isNil(step.nextAction),
          },
        },
      ];
    })
    .flat();

  return {
    nodes: [
      ...childGraphsAfterOffset.map((cg) => cg.nodes).flat(),
      subgraphEndSubNode,
    ],
    edges: [...childGraphsAfterOffset.map((cg) => cg.edges).flat(), ...edges],
  };
};

const offsetRouterChildSteps = (childGraphs: ApGraph[]) => {
  const childGraphsBoundingBoxes = childGraphs.map((childGraph) =>
    calculateGraphBoundingBox(childGraph),
  );
  const totalWidth =
    childGraphsBoundingBoxes.reduce((acc, current) => acc + current.width, 0) +
    flowCanvasConsts.HORIZONTAL_SPACE_BETWEEN_NODES * (childGraphs.length - 1);
  let deltaLeftX =
    -(
      totalWidth -
      childGraphsBoundingBoxes[0].left -
      childGraphsBoundingBoxes[childGraphs.length - 1].right
    ) /
      2 -
    childGraphsBoundingBoxes[0].left;

  return childGraphsBoundingBoxes.map((childGraphBoundingBox, index) => {
    const x = deltaLeftX + childGraphBoundingBox.left;
    deltaLeftX +=
      childGraphBoundingBox.width +
      flowCanvasConsts.HORIZONTAL_SPACE_BETWEEN_NODES;
    return offsetGraph(childGraphs[index], {
      x,
      y:
        flowCanvasConsts.AP_NODE_SIZE.STEP.height +
        flowCanvasConsts.VERTICAL_OFFSET_BETWEEN_ROUTER_AND_CHILD,
    });
  });
};

function assignInteractiveFlowLayers(
  nodes: InteractiveFlowNode[],
): Map<string, number> {
  const producer = new Map<string, string>();
  for (const n of nodes) {
    for (const out of n.stateOutputs) {
      if (!producer.has(out)) producer.set(out, n.id);
    }
  }
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  function resolve(nodeId: string): number {
    if (layer.has(nodeId)) return layer.get(nodeId)!;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    if (isNil(node)) {
      visiting.delete(nodeId);
      return 0;
    }
    let maxUpstream = -1;
    for (const input of node.stateInputs) {
      const up = producer.get(input);
      if (!isNil(up) && up !== nodeId) {
        maxUpstream = Math.max(maxUpstream, resolve(up));
      }
    }
    const level = maxUpstream + 1;
    layer.set(nodeId, level);
    visiting.delete(nodeId);
    return level;
  }
  for (const n of nodes) resolve(n.id);

  const consumersOf = new Map<string, string[]>();
  for (const n of nodes) {
    for (const input of n.stateInputs) {
      const upId = producer.get(input);
      if (!upId || upId === n.id) continue;
      if (!consumersOf.has(upId)) consumersOf.set(upId, []);
      consumersOf.get(upId)!.push(n.id);
    }
  }
  for (const n of nodes) {
    if (n.stateInputs.length !== 0) continue;
    const consumers = consumersOf.get(n.id);
    if (!consumers || consumers.length === 0) continue;
    const minConsumerLayer = Math.min(
      ...consumers.map((id) => layer.get(id) ?? 0),
    );
    const pushed = Math.max(0, minConsumerLayer - 1);
    if (pushed > (layer.get(n.id) ?? 0)) {
      layer.set(n.id, pushed);
    }
  }
  return layer;
}

function groupNodesByLayer(
  layers: Map<string, number>,
  nodes: InteractiveFlowNode[],
): InteractiveFlowNode[][] {
  const byLayer = new Map<number, InteractiveFlowNode[]>();
  for (const node of nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }
  const ordered: InteractiveFlowNode[][] = [];
  const maxLayer = Math.max(-1, ...Array.from(byLayer.keys()));
  for (let i = 0; i <= maxLayer; i++) {
    ordered.push(byLayer.get(i) ?? []);
  }
  return ordered;
}

function findProducerMap(nodes: InteractiveFlowNode[]): Map<string, string> {
  const producer = new Map<string, string>();
  for (const n of nodes) {
    for (const out of n.stateOutputs) {
      if (!producer.has(out)) producer.set(out, n.id);
    }
  }
  return producer;
}

function barycenterOrderLayers(
  initialLayers: InteractiveFlowNode[][],
  producer: Map<string, string>,
  layerOfNode: Map<string, number>,
): InteractiveFlowNode[][] {
  const orderedLayers = initialLayers.map((layer) => [...layer]);
  for (let layerIdx = 1; layerIdx < orderedLayers.length; layerIdx++) {
    const positionsInPrevLayers = new Map<string, number>();
    for (let i = 0; i < layerIdx; i++) {
      orderedLayers[i].forEach((n, idx) => {
        positionsInPrevLayers.set(n.id, idx);
      });
    }
    const scored = orderedLayers[layerIdx].map((node) => {
      const upstreamPositions: number[] = [];
      for (const input of node.stateInputs) {
        const srcId = producer.get(input);
        if (
          srcId &&
          srcId !== node.id &&
          (layerOfNode.get(srcId) ?? 0) < layerIdx
        ) {
          const pos = positionsInPrevLayers.get(srcId);
          if (pos !== undefined) upstreamPositions.push(pos);
        }
      }
      const barycenter =
        upstreamPositions.length === 0
          ? Number.POSITIVE_INFINITY
          : upstreamPositions.reduce((a, b) => a + b, 0) /
            upstreamPositions.length;
      return { node, barycenter };
    });
    scored.sort((a, b) => {
      if (a.barycenter !== b.barycenter) return a.barycenter - b.barycenter;
      return 0;
    });
    orderedLayers[layerIdx] = scored.map((s) => s.node);
  }
  return orderedLayers;
}

function computePhaseLookup(
  phases: InteractiveFlowPhase[] | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!phases) return lookup;
  for (const phase of phases) {
    for (const nodeId of phase.nodeIds) {
      if (!lookup.has(nodeId)) lookup.set(nodeId, phase.id);
    }
  }
  return lookup;
}

const buildInteractiveFlowChildGraph = (
  step: InteractiveFlowAction,
): ApGraph => {
  const interactiveNodes = step.settings.nodes;
  if (interactiveNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const stepWidth = flowCanvasConsts.AP_NODE_SIZE.STEP.width;
  const hSpace = flowCanvasConsts.HORIZONTAL_SPACE_BETWEEN_NODES;
  const vSpace = FLOW_CANVAS_VSPACE;
  const childHeight = FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT;
  const containerPadding = FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING;

  const layerOfNode = assignInteractiveFlowLayers(interactiveNodes);
  const initialLayers = groupNodesByLayer(layerOfNode, interactiveNodes);
  const producer = findProducerMap(interactiveNodes);
  const orderedLayers = barycenterOrderLayers(
    initialLayers,
    producer,
    layerOfNode,
  );
  const phaseLookup = computePhaseLookup(step.settings.phases);
  const parentCenterX = stepWidth / 2;
  const startY =
    flowCanvasConsts.AP_NODE_SIZE.STEP.height + vSpace + containerPadding;

  const nodeIdToCanvasId = new Map<string, string>();
  const childNodes: ApInteractiveFlowChildNode[] = [];
  let currentY = startY;

  orderedLayers.forEach((layer) => {
    const layerCount = layer.length;
    const layerWidth =
      layerCount * stepWidth + Math.max(0, layerCount - 1) * hSpace;
    const firstLeftX = parentCenterX - layerWidth / 2;
    layer.forEach((node, idx) => {
      const canvasId = `${step.name}-iflow-${node.id}`;
      nodeIdToCanvasId.set(node.id, canvasId);
      childNodes.push({
        id: canvasId,
        type: ApNodeType.INTERACTIVE_FLOW_CHILD,
        position: {
          x: firstLeftX + idx * (stepWidth + hSpace),
          y: currentY,
        },
        data: {
          parentStepName: step.name,
          node,
          hasDrift:
            node.nodeType === InteractiveFlowNodeType.TOOL &&
            !isNil(node.toolInputSchemaSnapshot) &&
            isNil(node.toolInputSchemaSnapshot.schema),
          isExtractorTarget:
            node.nodeType !== InteractiveFlowNodeType.BRANCH &&
            node.stateOutputs.some((out) => {
              const field = step.settings.stateFields.find(
                (f) => f.name === out,
              );
              return !isNil(field) && field.extractable !== false;
            }),
          phaseId: phaseLookup.get(node.id),
          phases: step.settings.phases,
        },
        selectable: false,
        zIndex: 10,
      });
    });
    currentY += childHeight + vSpace;
  });

  const childrenBottomY = currentY - vSpace;

  const returnNodeY = childrenBottomY + containerPadding + vSpace;
  const returnNode: ApNode = {
    id: `${step.name}-interactive-flow-return-node`,
    type: ApNodeType.INTERACTIVE_FLOW_RETURN_NODE,
    position: { x: 0, y: returnNodeY },
    data: {},
    selectable: false,
  };

  const subgraphEndY = returnNodeY + flowCanvasConsts.AP_NODE_SIZE.STEP.height;
  const subgraphEndSubNode: ApGraphEndNode = {
    id: `${step.name}-interactive-flow-subgraph-end`,
    type: ApNodeType.GRAPH_END_WIDGET,
    position: { x: stepWidth / 2, y: subgraphEndY },
    data: {},
    selectable: false,
  };

  const childrenMinX = Math.min(...childNodes.map((c) => c.position.x));
  const childrenMaxX = Math.max(
    ...childNodes.map((c) => c.position.x + stepWidth),
  );
  const containerX = childrenMinX - containerPadding;
  const containerY = startY - containerPadding;
  const containerWidth = childrenMaxX - childrenMinX + 2 * containerPadding;
  const containerHeight = subgraphEndY + containerPadding - containerY;

  const containerNode: ApInteractiveFlowContainerNode = {
    id: `${step.name}-interactive-flow-container`,
    type: ApNodeType.INTERACTIVE_FLOW_CONTAINER,
    position: { x: containerX, y: containerY },
    data: {
      parentStepName: step.name,
      parentDisplayName: step.displayName,
      width: containerWidth,
      height: containerHeight,
    },
    selectable: false,
    draggable: false,
    zIndex: -1,
  };

  const firstLayerNodes = orderedLayers[0] ?? [];
  const startEdges: ApInteractiveFlowStartEdge[] = firstLayerNodes.map(
    (node) => ({
      id: `${step.name}-iflow-start-${node.id}`,
      source: step.name,
      target: nodeIdToCanvasId.get(node.id)!,
      type: ApEdgeType.INTERACTIVE_FLOW_START_EDGE,
      data: { parentStepName: step.name },
    }),
  );

  const lastLayerNodes = orderedLayers[orderedLayers.length - 1] ?? [];
  const returnEdges: ApInteractiveFlowReturnEdge[] = lastLayerNodes.map(
    (node) => ({
      id: `${step.name}-iflow-return-${node.id}`,
      source: nodeIdToCanvasId.get(node.id)!,
      target: returnNode.id,
      type: ApEdgeType.INTERACTIVE_FLOW_RETURN_EDGE,
      data: {
        parentStepName: step.name,
        drawArrowHeadAfterEnd: !isNil(step.nextAction),
      },
    }),
  );

  const edgeAggregation = new Map<
    string,
    {
      source: string;
      target: string;
      fieldNames: string[];
      sourceId: string;
      targetId: string;
    }
  >();
  for (const node of interactiveNodes) {
    for (const input of node.stateInputs) {
      const srcId = producer.get(input);
      if (!srcId || srcId === node.id) continue;
      if (!nodeIdToCanvasId.has(srcId) || !nodeIdToCanvasId.has(node.id))
        continue;
      const key = `${srcId}->${node.id}`;
      const existing = edgeAggregation.get(key) ?? {
        source: nodeIdToCanvasId.get(srcId)!,
        target: nodeIdToCanvasId.get(node.id)!,
        fieldNames: [],
        sourceId: srcId,
        targetId: node.id,
      };
      existing.fieldNames.push(input);
      edgeAggregation.set(key, existing);
    }
  }

  const childEdges: ApInteractiveFlowDataEdge[] = [];
  for (const {
    source,
    target,
    fieldNames,
    sourceId,
    targetId,
  } of edgeAggregation.values()) {
    const sourceLayer = layerOfNode.get(sourceId) ?? 0;
    const targetLayer = layerOfNode.get(targetId) ?? 0;
    const isSkipConnection = targetLayer - sourceLayer > 1;
    const sourceNode = interactiveNodes.find((n) => n.id === sourceId);
    const targetNode = interactiveNodes.find((n) => n.id === targetId);
    const branchName = targetNode
      ? findBranchEdgeLabel(targetNode, interactiveNodes)
      : undefined;
    childEdges.push({
      id: `${step.name}-iflow-edge-${sourceId}-${targetId}`,
      source,
      target,
      type: ApEdgeType.INTERACTIVE_FLOW_DATA_EDGE,
      data: {
        parentStepName: step.name,
        fieldNames,
        branchName,
        isSkipConnection,
        sourceDisplayName: sourceNode?.displayName,
        targetDisplayName: targetNode?.displayName,
      },
    });
  }

  return {
    nodes: [containerNode, ...childNodes, returnNode, subgraphEndSubNode],
    edges: [...startEdges, ...returnEdges, ...childEdges],
  };
};

function findBranchEdgeLabel(
  targetNode: InteractiveFlowNode,
  nodes: InteractiveFlowNode[],
): string | undefined {
  for (const n of nodes) {
    if (n.nodeType !== InteractiveFlowNodeType.BRANCH) continue;
    const branchNode = n as InteractiveFlowBranchNode;
    const matching = branchNode.branches.find((b) =>
      b.targetNodeIds.includes(targetNode.id),
    );
    if (!isNil(matching)) return matching.branchName;
  }
  return undefined;
}

const createAddOperationFromAddButtonData = (data: ApButtonData) => {
  if (
    data.stepLocationRelativeToParent ===
    StepLocationRelativeToParent.INSIDE_BRANCH
  ) {
    return {
      type: FlowOperationType.ADD_ACTION,
      actionLocation: {
        parentStep: data.parentStepName,
        stepLocationRelativeToParent: data.stepLocationRelativeToParent,
        branchIndex: data.branchIndex,
      },
    } as const;
  }
  return {
    type: FlowOperationType.ADD_ACTION,
    actionLocation: {
      parentStep: data.parentStepName,
      stepLocationRelativeToParent: data.stepLocationRelativeToParent,
    },
  } as const;
};

const isSkipped = (stepName: string, trigger: FlowTrigger) => {
  const step = flowStructureUtil.getStep(stepName, trigger);
  if (
    isNil(step) ||
    step.type === FlowTriggerType.EMPTY ||
    step.type === FlowTriggerType.PIECE
  ) {
    return false;
  }
  const skippedParents = flowStructureUtil
    .findPathToStep(trigger, stepName)
    .filter(
      (stepInPath) =>
        stepInPath.type === FlowActionType.LOOP_ON_ITEMS ||
        stepInPath.type === FlowActionType.ROUTER,
    )
    .filter((routerOrLoop) =>
      flowStructureUtil.isChildOf(routerOrLoop, stepName),
    )
    .filter((parent) => parent.skip);

  return skippedParents.length > 0 || !!step.skip;
};

const getStepStatus = (
  stepName: string | undefined,
  run: FlowRun | null,
  loopIndexes: Record<string, number>,
) => {
  if (isNil(run) || isNil(stepName) || isNil(run.steps)) {
    return undefined;
  }
  const stepOutput = flowRunUtils.extractStepOutput(
    stepName,
    loopIndexes,
    run.steps,
  );
  return stepOutput?.status;
};
function buildNotesGraph(notes: Note[]): ApGraph {
  return {
    nodes: notes.map((note) => ({
      id: note.id,
      type: ApNodeType.NOTE,
      draggable: true,
      position: note.position,
      data: {
        content: note.content,
        creatorId: note.ownerId,
        color: note.color,
        size: note.size,
      },
    })),
    edges: [],
  };
}

function determineInitiallySelectedStep(
  failedStepNameInRun: string | null,
  flowVersion: FlowVersion,
): string | null {
  const firstInvalidStep = flowStructureUtil
    .getAllSteps(flowVersion.trigger)
    .find((s) => !s.valid);
  const isNewFlow = window.location.search.includes(NEW_FLOW_QUERY_PARAM);
  if (failedStepNameInRun) {
    return failedStepNameInRun;
  }
  if (isNewFlow) {
    return null;
  }
  return firstInvalidStep?.name ?? 'trigger';
}
const doesSelectionRectangleExist = () => {
  return (
    document.querySelector(
      `.${flowCanvasConsts.NODE_SELECTION_RECT_CLASS_NAME}`,
    ) !== null
  );
};
export const flowCanvasUtils = {
  createFlowGraph(version: FlowVersion, notes: Note[]): ApGraph {
    const stepsGraph = buildFlowGraph(version.trigger);
    const notesGraph = buildNotesGraph(notes);
    const graphEndWidget = stepsGraph.nodes.findLast(
      (node) => node.type === ApNodeType.GRAPH_END_WIDGET,
    ) as ApGraphEndNode;
    if (graphEndWidget) {
      graphEndWidget.data.showWidget = true;
    } else {
      console.warn('Flow end widget not found');
    }
    return mergeGraph(stepsGraph, notesGraph);
  },
  createFocusStepInGraphParams,
  calculateGraphBoundingBox,
  createAddOperationFromAddButtonData,
  isSkipped,
  getStepStatus,
  determineInitiallySelectedStep,
  doesSelectionRectangleExist,
  buildInteractiveFlowChildGraph,
};
