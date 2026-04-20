// @vitest-environment jsdom
/**
 * CI gate: zero-overlap guarantee across representative fixtures.
 *
 * This suite is the programmatic equivalent of `validate-canvas-overlaps`:
 * it runs `buildInteractiveFlowChildGraph` on the fixtures we care about
 * (linear chain, real Estinzione, fan-out, fan-in, with phases) and
 * asserts:
 *   - No two child nodes overlap.
 *   - Every child fits strictly within the container bbox.
 *   - Return node is below the last layer.
 *   - End widget is below the return node and collinear with it.
 *   - Edge IDs are unique.
 *
 * Failing this test blocks the build. Extend with new fixtures as
 * real-world flow patterns emerge.
 */
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
  ApInteractiveFlowChildNode,
  ApInteractiveFlowContainerNode,
  ApNodeType,
} from './types';

type Box = { x: number; y: number; width: number; height: number; id: string };

function toBox(n: ApInteractiveFlowChildNode): Box {
  return {
    x: n.position.x,
    y: n.position.y,
    width: FLOW_CANVAS_STEP_WIDTH,
    height: FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
    id: n.data.node.id,
  };
}

function overlap(a: Box, b: Box): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function tool(
  id: string,
  stateInputs: string[],
  stateOutputs: string[],
): InteractiveFlowNode {
  return {
    id,
    name: id,
    displayName: id,
    nodeType: InteractiveFlowNodeType.TOOL,
    tool: 'test/tool',
    stateInputs,
    stateOutputs,
  };
}

function userInput(
  id: string,
  stateInputs: string[],
  stateOutputs: string[],
): InteractiveFlowNode {
  return {
    id,
    name: id,
    displayName: id,
    nodeType: InteractiveFlowNodeType.USER_INPUT,
    render: { component: 'Dummy', props: {} },
    message: { en: 'hi' },
    stateInputs,
    stateOutputs,
  };
}

function buildAction(
  name: string,
  nodes: InteractiveFlowNode[],
  phases?: InteractiveFlowPhase[],
): InteractiveFlowAction {
  return {
    name,
    displayName: name,
    type: FlowActionType.INTERACTIVE_FLOW,
    skip: false,
    valid: true,
    lastUpdatedDate: new Date().toISOString(),
    settings: { nodes, stateFields: [], phases },
  };
}

const fixtures: Array<{ name: string; action: InteractiveFlowAction }> = [
  {
    name: 'linear-chain-10',
    action: buildAction(
      'linear',
      Array.from({ length: 10 }).map((_, i) =>
        tool(`n${i}`, i === 0 ? [] : [`f${i - 1}`], [`f${i}`]),
      ),
    ),
  },
  {
    name: 'estinzione-real',
    action: buildAction('estinzione', [
      tool('search_customer', ['customerName'], ['customerMatches']),
      userInput('pick_ndg', ['customerMatches'], ['ndg']),
      tool('load_profile', ['ndg'], ['profile']),
      tool('load_accounts', ['ndg'], ['accounts']),
      userInput('pick_rapporto', ['accounts'], ['rapportoId']),
      tool('load_reasons', ['rapportoId'], ['closureReasons']),
      userInput('collect_reason', ['closureReasons'], ['closureReasonCode']),
      userInput('collect_date', [], ['closureDate']),
      tool(
        'generate_pdf',
        ['ndg', 'rapportoId', 'closureReasonCode', 'closureDate'],
        ['moduleBase64'],
      ),
      userInput('confirm_closure', ['moduleBase64', 'profile'], ['confirmed']),
      tool(
        'submit',
        ['confirmed', 'ndg', 'rapportoId', 'closureReasonCode', 'closureDate'],
        ['caseId'],
      ),
    ]),
  },
  {
    name: 'fan-out-3',
    action: buildAction('fanout', [
      tool('root', [], ['x']),
      tool('a', ['x'], ['a_out']),
      tool('b', ['x'], ['b_out']),
      tool('c', ['x'], ['c_out']),
    ]),
  },
  {
    name: 'fan-in-4',
    action: buildAction('fanin', [
      tool('a', [], ['a_out']),
      tool('b', [], ['b_out']),
      tool('c', [], ['c_out']),
      tool('d', [], ['d_out']),
      tool('merge', ['a_out', 'b_out', 'c_out', 'd_out'], ['merged']),
    ]),
  },
  {
    name: 'with-phases',
    action: buildAction(
      'phased',
      [tool('a', [], ['x']), tool('b', ['x'], ['y']), tool('c', ['y'], [])],
      [
        { id: 'p1', name: 'Phase 1', nodeIds: ['a'] },
        { id: 'p2', name: 'Phase 2', nodeIds: ['b'] },
        { id: 'p3', name: 'Phase 3', nodeIds: ['c'] },
      ],
    ),
  },
];

describe.each(fixtures)('canvas overlap gate: $name', ({ action }) => {
  const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(action);
  const children = graph.nodes.filter(
    (n): n is ApInteractiveFlowChildNode =>
      n.type === ApNodeType.INTERACTIVE_FLOW_CHILD,
  );
  const boxes = children.map(toBox);

  it('no two child nodes overlap', () => {
    const overlappingPairs: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlap(boxes[i], boxes[j])) {
          overlappingPairs.push(`${boxes[i].id} vs ${boxes[j].id}`);
        }
      }
    }
    expect(overlappingPairs).toEqual([]);
  });

  it('every child fits strictly within the container bbox', () => {
    const container = graph.nodes.find(
      (n): n is ApInteractiveFlowContainerNode =>
        n.type === ApNodeType.INTERACTIVE_FLOW_CONTAINER,
    );
    if (!container) {
      expect(boxes.length).toBe(0);
      return;
    }
    const cbox: Box = {
      x: container.position.x,
      y: container.position.y,
      width: container.data.width,
      height: container.data.height,
      id: 'container',
    };
    const outside: string[] = [];
    for (const b of boxes) {
      if (b.x < cbox.x - 0.5) outside.push(`${b.id}.x<container.x`);
      if (b.y < cbox.y - 0.5) outside.push(`${b.id}.y<container.y`);
      if (b.x + b.width > cbox.x + cbox.width + 0.5) {
        outside.push(`${b.id}.right>container.right`);
      }
      if (b.y + b.height > cbox.y + cbox.height + 0.5) {
        outside.push(`${b.id}.bottom>container.bottom`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('return node is below every child', () => {
    const returnNode = graph.nodes.find(
      (n) => n.type === ApNodeType.INTERACTIVE_FLOW_RETURN_NODE,
    );
    if (!returnNode || children.length === 0) return;
    const maxBottom = Math.max(...boxes.map((b) => b.y + b.height));
    expect(returnNode.position.y).toBeGreaterThanOrEqual(maxBottom);
  });

  it('end widget is below and horizontally centered on the return node column', () => {
    const end = graph.nodes.find((n) => n.type === ApNodeType.GRAPH_END_WIDGET);
    const ret = graph.nodes.find(
      (n) => n.type === ApNodeType.INTERACTIVE_FLOW_RETURN_NODE,
    );
    if (!end || !ret) {
      expect(children.length).toBe(0);
      return;
    }
    expect(end.position.y).toBeGreaterThan(ret.position.y);
    // end widget is a zero-width anchor at the center of the return column
    expect(end.position.x).toBe(FLOW_CANVAS_STEP_WIDTH / 2);
    expect(ret.position.x).toBe(0);
  });

  it('edge IDs are unique', () => {
    const ids = graph.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
