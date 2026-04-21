// @vitest-environment jsdom
import {
  FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
  FLOW_CANVAS_STEP_WIDTH,
  FlowActionType,
  InteractiveFlowAction,
  InteractiveFlowNode,
  InteractiveFlowNodeType,
  InteractiveFlowPhase,
} from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { flowCanvasUtils } from './flow-canvas-utils';
import {
  ApEdgeType,
  ApInteractiveFlowChildNode,
  ApInteractiveFlowContainerNode,
  ApNodeType,
} from './types';

function toolNode(opts: {
  id: string;
  stateInputs?: string[];
  stateOutputs?: string[];
  tool?: string;
}): InteractiveFlowNode {
  return {
    id: opts.id,
    name: opts.id,
    displayName: opts.id,
    nodeType: InteractiveFlowNodeType.TOOL,
    tool: opts.tool ?? 'test/tool',
    stateInputs: opts.stateInputs ?? [],
    stateOutputs: opts.stateOutputs ?? [],
  };
}

function userInputNode(opts: {
  id: string;
  stateInputs?: string[];
  stateOutputs?: string[];
}): InteractiveFlowNode {
  return {
    id: opts.id,
    name: opts.id,
    displayName: opts.id,
    nodeType: InteractiveFlowNodeType.USER_INPUT,
    render: { component: 'TextInput', props: {} },
    message: { en: 'hi' },
    stateInputs: opts.stateInputs ?? [],
    stateOutputs: opts.stateOutputs ?? [],
  };
}

function buildAction(
  nodes: InteractiveFlowNode[],
  phases?: InteractiveFlowPhase[],
): InteractiveFlowAction {
  return {
    name: 'iflow_test',
    displayName: 'Estinzione',
    type: FlowActionType.INTERACTIVE_FLOW,
    skip: false,
    valid: true,
    lastUpdatedDate: new Date().toISOString(),
    settings: {
      nodes,
      stateFields: [],
      phases,
    },
  };
}

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function childBox(n: ApInteractiveFlowChildNode) {
  return {
    x: n.position.x,
    y: n.position.y,
    w: FLOW_CANVAS_STEP_WIDTH,
    h: FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
  };
}

describe('buildInteractiveFlowChildGraph — new layer-based layout', () => {
  it('empty graph when no nodes', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([]),
    );
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('linear chain: all children at x=0 (collinear with parent)', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'], stateOutputs: ['y'] }),
        toolNode({ id: 'c', stateInputs: ['y'] }),
      ]),
    );
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    expect(children).toHaveLength(3);
    for (const c of children) {
      expect(c.position.x).toBe(0);
    }
  });

  it('parallel nodes in same layer have equal y and distinct x centered on 0', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'root', stateOutputs: ['ndg'] }),
        toolNode({ id: 'a', stateInputs: ['ndg'] }),
        toolNode({ id: 'b', stateInputs: ['ndg'] }),
      ]),
    );
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    const byId = new Map(children.map((c) => [c.data.node.id, c]));
    expect(byId.get('a')!.position.y).toBe(byId.get('b')!.position.y);
    expect(byId.get('a')!.position.x).not.toBe(byId.get('b')!.position.x);
    // Simmetrici attorno all'asse centrale del parent (STEP_WIDTH/2)
    const center = FLOW_CANVAS_STEP_WIDTH / 2;
    const aCenter = byId.get('a')!.position.x + FLOW_CANVAS_STEP_WIDTH / 2;
    const bCenter = byId.get('b')!.position.x + FLOW_CANVAS_STEP_WIDTH / 2;
    expect(Math.abs(aCenter - center + (bCenter - center))).toBeLessThan(1);
  });

  it('estinzione: collect_reason and collect_date are placed on same layer side-by-side (parallel siblings)', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({
          id: 'load_reasons',
          stateInputs: ['rapportoId'],
          stateOutputs: ['closureReasons'],
        }),
        userInputNode({
          id: 'collect_reason',
          stateInputs: ['closureReasons'],
          stateOutputs: ['closureReasonCode'],
        }),
        userInputNode({
          id: 'collect_date',
          stateInputs: ['closureReasons'],
          stateOutputs: ['closureDate'],
        }),
        toolNode({
          id: 'generate_pdf',
          stateInputs: ['closureReasonCode', 'closureDate'],
          stateOutputs: ['moduleBase64'],
        }),
      ]),
    );
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    const byId = new Map(children.map((c) => [c.data.node.id, c]));
    expect(byId.get('collect_reason')!.position.y).toBe(
      byId.get('collect_date')!.position.y,
    );
    expect(byId.get('collect_reason')!.position.x).not.toBe(
      byId.get('collect_date')!.position.x,
    );
    expect(byId.get('generate_pdf')!.position.y).toBeGreaterThan(
      byId.get('collect_reason')!.position.y,
    );
    expect(byId.get('collect_reason')!.position.y).toBeGreaterThan(
      byId.get('load_reasons')!.position.y,
    );
  });

  it('no two child nodes have overlapping bounding boxes (complex Estinzione layout)', () => {
    const nodes: InteractiveFlowNode[] = [
      toolNode({
        id: 'search',
        stateInputs: ['customerName'],
        stateOutputs: ['customerMatches'],
      }),
      userInputNode({
        id: 'pick_ndg',
        stateInputs: ['customerMatches'],
        stateOutputs: ['ndg'],
      }),
      toolNode({
        id: 'load_profile',
        stateInputs: ['ndg'],
        stateOutputs: ['profile'],
      }),
      toolNode({
        id: 'load_accounts',
        stateInputs: ['ndg'],
        stateOutputs: ['accounts'],
      }),
      userInputNode({
        id: 'pick_rapporto',
        stateInputs: ['accounts'],
        stateOutputs: ['rapportoId'],
      }),
      toolNode({
        id: 'load_reasons',
        stateInputs: ['rapportoId'],
        stateOutputs: ['closureReasons'],
      }),
      userInputNode({
        id: 'collect_reason',
        stateInputs: ['closureReasons'],
        stateOutputs: ['closureReasonCode'],
      }),
      userInputNode({
        id: 'collect_date',
        stateInputs: [],
        stateOutputs: ['closureDate'],
      }),
      toolNode({
        id: 'generate_pdf',
        stateInputs: ['ndg', 'rapportoId', 'closureReasonCode', 'closureDate'],
        stateOutputs: ['moduleBase64'],
      }),
    ];
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction(nodes),
    );
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    let overlapCount = 0;
    const overlapPairs: string[] = [];
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = childBox(children[i]);
        const b = childBox(children[j]);
        if (overlap(a, b)) {
          overlapCount++;
          overlapPairs.push(`${children[i].id}/${children[j].id}`);
        }
      }
    }
    expect(overlapPairs).toEqual([]);
    expect(overlapCount).toBe(0);
  });

  it('no intermediate return node is emitted (subgraph is flat submit -> end)', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const returnNode = graph.nodes.find(
      (n) => n.type === ApNodeType.INTERACTIVE_FLOW_RETURN_NODE,
    );
    expect(returnNode).toBeUndefined();
  });

  it('end widget is centered below the last layer child column', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([toolNode({ id: 'a' })]),
    );
    const endWidget = graph.nodes.find(
      (n) => n.type === ApNodeType.GRAPH_END_WIDGET,
    );
    const children = graph.nodes.filter(
      (n) => n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    expect(endWidget).toBeDefined();
    expect(endWidget!.position.x).toBe(FLOW_CANVAS_STEP_WIDTH / 2);
    const maxChildY = Math.max(...children.map((c) => c.position.y));
    expect(endWidget!.position.y).toBeGreaterThan(maxChildY);
  });

  it('uses INTERACTIVE_FLOW_RETURN_EDGE, not LOOP_RETURN_EDGE', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([toolNode({ id: 'a' })]),
    );
    expect(
      graph.edges.every((e) => e.type !== ApEdgeType.LOOP_RETURN_EDGE),
    ).toBe(true);
    expect(
      graph.edges.some(
        (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_RETURN_EDGE,
      ),
    ).toBe(true);
  });

  it('uses INTERACTIVE_FLOW_START_EDGE instead of LOOP_START_EDGE', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([toolNode({ id: 'a' })]),
    );
    expect(
      graph.edges.every((e) => e.type !== ApEdgeType.LOOP_START_EDGE),
    ).toBe(true);
    expect(
      graph.edges.some(
        (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_START_EDGE,
      ),
    ).toBe(true);
  });

  it('parent step of an INTERACTIVE_FLOW does not emit a STRAIGHT_LINE to its own subgraph-end (no duplicate arrow)', () => {
    const trigger = {
      name: 'trigger',
      displayName: 'Trigger',
      type: 'EMPTY',
      valid: true,
      skip: false,
      lastUpdatedDate: new Date().toISOString(),
      settings: {},
      nextAction: buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    };
    const graph = flowCanvasUtils.createFlowGraph(
      {
        id: 'v',
        created: '',
        updated: '',
        flowId: 'f',
        updatedBy: '',
        displayName: 'test',
        agentIds: [],
        notes: [],
        valid: true,
        state: 'DRAFT',
        schemaVersion: '1',
        trigger,
      } as unknown as Parameters<typeof flowCanvasUtils.createFlowGraph>[0],
      [],
    );
    const iflowStepName = 'iflow_test';
    const straightFromIflow = graph.edges.filter(
      (e) => e.type === ApEdgeType.STRAIGHT_LINE && e.source === iflowStepName,
    );
    expect(straightFromIflow).toHaveLength(0);
    const startEdges = graph.edges.filter(
      (e) =>
        e.type === ApEdgeType.INTERACTIVE_FLOW_START_EDGE &&
        e.source === iflowStepName,
    );
    expect(startEdges.length).toBeGreaterThan(0);
  });

  it('emits one edge per (source, target) pair, aggregating fieldNames', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['f1', 'f2'] }),
        toolNode({ id: 'b', stateInputs: ['f1', 'f2'] }),
      ]),
    );
    const dataEdges = graph.edges.filter(
      (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_DATA_EDGE,
    );
    const abEdges = dataEdges.filter(
      (e) => e.source.includes('-a') && e.target.includes('-b'),
    );
    expect(abEdges).toHaveLength(1);
    expect(
      (abEdges[0] as { data: { fieldNames: string[] } }).data.fieldNames,
    ).toEqual(['f1', 'f2']);
  });

  it('edge IDs are stable in format ${step}-iflow-edge-${sourceId}-${targetId}', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const dataEdges = graph.edges.filter(
      (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_DATA_EDGE,
    );
    expect(dataEdges[0].id).toContain('iflow-edge-');
    expect(dataEdges[0].id).toContain('a');
    expect(dataEdges[0].id).toContain('b');
    // Unicità: nessun duplicato
    const allIds = graph.edges.map((e) => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('flags edges with layerDiff > 1 as skip-connections', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'], stateOutputs: ['y'] }),
        toolNode({ id: 'c', stateInputs: ['y'], stateOutputs: ['z'] }),
        toolNode({ id: 'd', stateInputs: ['x', 'z'] }), // legge x da L0 (skip)
      ]),
    );
    const dataEdges = graph.edges.filter(
      (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_DATA_EDGE,
    );
    const adEdge = dataEdges.find(
      (e) => e.source.includes('-a') && e.target.includes('-d'),
    );
    expect(adEdge).toBeDefined();
    expect(
      (adEdge as { data: { isSkipConnection?: boolean } }).data
        .isSkipConnection,
    ).toBe(true);
    const cdEdge = dataEdges.find(
      (e) => e.source.includes('-c') && e.target.includes('-d'),
    );
    expect(
      (cdEdge as { data: { isSkipConnection?: boolean } }).data
        .isSkipConnection,
    ).not.toBe(true);
  });

  it('emits a container node when there are children', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const container = graph.nodes.find(
      (n): n is ApInteractiveFlowContainerNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CONTAINER,
    );
    expect(container).toBeDefined();
    expect(container!.data.parentDisplayName).toBe('Estinzione');
  });

  it('container strictly encloses all children', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'root', stateOutputs: ['x'] }),
        toolNode({ id: 'a', stateInputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const container = graph.nodes.find(
      (n): n is ApInteractiveFlowContainerNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CONTAINER,
    )!;
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    for (const c of children) {
      expect(c.position.x).toBeGreaterThanOrEqual(container.position.x);
      expect(c.position.y).toBeGreaterThanOrEqual(container.position.y);
      expect(c.position.x + FLOW_CANVAS_STEP_WIDTH).toBeLessThanOrEqual(
        container.position.x + container.data.width,
      );
      expect(
        c.position.y + FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
      ).toBeLessThanOrEqual(container.position.y + container.data.height);
    }
  });

  it('end widget sits below the container (outside it)', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const container = graph.nodes.find(
      (n): n is ApInteractiveFlowContainerNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CONTAINER,
    )!;
    const endWidget = graph.nodes.find(
      (n) => n.type === ApNodeType.GRAPH_END_WIDGET,
    )!;
    const containerBottom = container.position.y + container.data.height;
    expect(endWidget.position.y).toBeGreaterThan(containerBottom);
  });

  it('container height is minimal (children + padding only, no End area)', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const container = graph.nodes.find(
      (n): n is ApInteractiveFlowContainerNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CONTAINER,
    )!;
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    const childrenTop = Math.min(...children.map((c) => c.position.y));
    const childrenBottom = Math.max(
      ...children.map(
        (c) => c.position.y + FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
      ),
    );
    const childrenHeight = childrenBottom - childrenTop;
    // Container should roughly equal childrenHeight + 2*padding (no End area).
    // Allow a small tolerance since padding constant may vary over time.
    expect(container.data.height).toBeLessThan(childrenHeight + 100);
  });

  it('return edge connects the last child directly to the end widget', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'a', stateOutputs: ['x'] }),
        toolNode({ id: 'b', stateInputs: ['x'] }),
      ]),
    );
    const endWidget = graph.nodes.find(
      (n) => n.type === ApNodeType.GRAPH_END_WIDGET,
    )!;
    const returnEdge = graph.edges.find(
      (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_RETURN_EDGE,
    )!;
    expect(returnEdge.target).toBe(endWidget.id);
    expect(returnEdge.source).toContain('iflow-b');
  });

  it('container is not emitted when there are zero nodes', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([]),
    );
    expect(
      graph.nodes.some((n) => n.type === ApNodeType.INTERACTIVE_FLOW_CONTAINER),
    ).toBe(false);
  });

  it('injects phaseId and phases into child data when phases are defined', () => {
    const phases: InteractiveFlowPhase[] = [
      { id: 'ph1', name: 'phase1', nodeIds: ['a', 'b'] },
      { id: 'ph2', name: 'phase2', nodeIds: ['c'] },
    ];
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction(
        [
          toolNode({ id: 'a', stateOutputs: ['x'] }),
          toolNode({ id: 'b', stateInputs: ['x'], stateOutputs: ['y'] }),
          toolNode({ id: 'c', stateInputs: ['y'] }),
        ],
        phases,
      ),
    );
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    const byId = new Map(children.map((c) => [c.data.node.id, c]));
    expect(byId.get('a')!.data.phaseId).toBe('ph1');
    expect(byId.get('b')!.data.phaseId).toBe('ph1');
    expect(byId.get('c')!.data.phaseId).toBe('ph2');
    expect(byId.get('a')!.data.phases).toEqual(phases);
  });

  it('child data.phaseId is undefined when phases are not defined', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([toolNode({ id: 'a' })]),
    );
    const child = graph.nodes.find(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    )!;
    expect(child.data.phaseId).toBeUndefined();
  });

  it('isolated node (no upstream producer) receives an entry edge from parent step', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([toolNode({ id: 'lonely', stateInputs: ['unknownField'] })]),
    );
    const startEdges = graph.edges.filter(
      (e) => e.type === ApEdgeType.INTERACTIVE_FLOW_START_EDGE,
    );
    expect(startEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('barycenter ordering: second layer permutes to reduce crossings', () => {
    // L0 nodes: A (leftmost), B (middle), C (rightmost)
    // L1 nodes reading A, B, C in order: X→C, Y→A, Z→B
    // After barycenter ordering, L1 should reorder to [Y, Z, X] to reduce crossings.
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([
        toolNode({ id: 'A', stateOutputs: ['a'] }),
        toolNode({ id: 'B', stateOutputs: ['b'] }),
        toolNode({ id: 'C', stateOutputs: ['c'] }),
        toolNode({ id: 'X', stateInputs: ['c'] }),
        toolNode({ id: 'Y', stateInputs: ['a'] }),
        toolNode({ id: 'Z', stateInputs: ['b'] }),
      ]),
    );
    const children = graph.nodes.filter(
      (n): n is ApInteractiveFlowChildNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
    );
    const byId = new Map(children.map((c) => [c.data.node.id, c]));
    // Expected ordering (x-ascending) in L1: Y (under A), Z (under B), X (under C)
    const ySorted = [byId.get('Y')!, byId.get('Z')!, byId.get('X')!]
      .sort((p, q) => p.position.x - q.position.x)
      .map((n) => n.data.node.id);
    expect(ySorted).toEqual(['Y', 'Z', 'X']);
  });
});
