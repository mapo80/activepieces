// @vitest-environment jsdom
import {
  FlowActionType,
  InteractiveFlowAction,
  InteractiveFlowNodeType,
} from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { flowCanvasUtils } from './flow-canvas-utils';

function buildAction(
  nodes: InteractiveFlowAction['settings']['nodes'],
  stateFields: InteractiveFlowAction['settings']['stateFields'] = [],
): InteractiveFlowAction {
  return {
    name: 'interactive_flow',
    displayName: 'Interactive Flow',
    type: FlowActionType.INTERACTIVE_FLOW,
    skip: false,
    valid: true,
    lastUpdatedDate: new Date().toISOString(),
    settings: {
      nodes,
      stateFields,
    },
  };
}

describe('interactive-flow canvas layout', () => {
  it('renders INTERACTIVE_FLOW_CHILD nodes + return + end widget and labeled edges', () => {
    const action = buildAction([
      {
        id: 'a',
        name: 'a',
        displayName: 'Collect name',
        nodeType: InteractiveFlowNodeType.USER_INPUT,
        stateInputs: [],
        stateOutputs: ['clientName'],
        render: { component: 'TextInput', props: {} },
        message: { en: 'enter name' },
      },
      {
        id: 'b',
        name: 'b',
        displayName: 'Search',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['clientName'],
        stateOutputs: ['searchResults'],
        tool: 'banking/search',
      },
    ]);

    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(action);
    const childTypes = graph.nodes.map((n) => n.type);
    expect(childTypes).toContain('INTERACTIVE_FLOW_CHILD');
    expect(childTypes).toContain('INTERACTIVE_FLOW_RETURN_NODE');
    expect(childTypes).toContain('GRAPH_END_WIDGET');

    const dataEdges = graph.edges.filter(
      (e) => e.type === 'ApInteractiveFlowDataEdge',
    );
    expect(dataEdges).toHaveLength(1);
    expect(
      (dataEdges[0] as { data: { fieldName?: string } }).data.fieldName,
    ).toBe('clientName');
  });

  it('topologically orders nodes (upstream before downstream) even if defined out of order', () => {
    const action = buildAction([
      {
        id: 'b',
        name: 'b',
        displayName: 'B',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['clientName'],
        stateOutputs: ['result'],
        tool: 'banking/b',
      },
      {
        id: 'a',
        name: 'a',
        displayName: 'A',
        nodeType: InteractiveFlowNodeType.USER_INPUT,
        stateInputs: [],
        stateOutputs: ['clientName'],
        render: { component: 'TextInput', props: {} },
        message: { en: 'name' },
      },
    ]);

    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(action);
    const childNodes = graph.nodes.filter(
      (n) => n.type === 'INTERACTIVE_FLOW_CHILD',
    );
    const ys = childNodes.map((n) => n.position.y);
    const ids = childNodes.map(
      (n) => (n as { data: { node: { id: string } } }).data.node.id,
    );
    const aIdx = ids.indexOf('a');
    const bIdx = ids.indexOf('b');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(ys[aIdx]).toBeLessThan(ys[bIdx]);
  });

  it('annotates data edges with the branch name when the target is a BRANCH target', () => {
    const action = buildAction([
      {
        id: 'router',
        name: 'router',
        displayName: 'Route',
        nodeType: InteractiveFlowNodeType.BRANCH,
        stateInputs: ['clientType'],
        stateOutputs: [],
        branches: [
          {
            id: 'br1',
            branchName: 'corporate',
            branchType: 'CONDITION',
            conditions: [],
            targetNodeIds: ['corp'],
          },
          {
            id: 'br2',
            branchName: 'individual',
            branchType: 'FALLBACK',
            targetNodeIds: ['indiv'],
          },
        ],
      },
      {
        id: 'corp',
        name: 'corp',
        displayName: 'Corp',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['clientType'],
        stateOutputs: ['corpData'],
        tool: 'banking/corp',
      },
      {
        id: 'indiv',
        name: 'indiv',
        displayName: 'Indiv',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['clientType'],
        stateOutputs: ['indivData'],
        tool: 'banking/indiv',
      },
    ]);

    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(action);
    const dataEdges = graph.edges.filter(
      (e) => e.type === 'ApInteractiveFlowDataEdge',
    );
    const branchLabels = dataEdges
      .map((e) => (e as { data: { branchName?: string } }).data.branchName)
      .filter((label): label is string => !!label);
    expect(branchLabels).toContain('corporate');
    expect(branchLabels).toContain('individual');
  });

  it('returns an empty graph for zero-node actions', () => {
    const graph = flowCanvasUtils.buildInteractiveFlowChildGraph(
      buildAction([]),
    );
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
