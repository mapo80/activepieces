/**
 * Structural assertion helper for Copilot-generated flows.
 *
 * Unlike `assertFlowSemanticallyEquivalent` (which compares against a
 * known-good fixture with exact field names), this helper validates that
 * the generated flow has the SHAPE a healthy INTERACTIVE_FLOW should
 * have, without requiring specific field/node names. Perfect for the
 * generic-domain gate where the LLM composes names freely from the
 * brief.
 *
 * Checks:
 *  - INTERACTIVE_FLOW action present
 *  - stateFields count within [min, max]
 *  - nodes count within [min, max]
 *  - mix of node types (at least 1 TOOL, 1 USER_INPUT, 1 CONFIRM)
 *  - exactly one CONFIRM node
 *  - `confirmed` trigger field is boolean + extractable + node-local
 *  - systemPrompt non-empty and mostly Italian
 *  - mcpGatewayId set
 *  - locale = 'it'
 *  - Topological validity (stateInputs all produced or extractable)
 *  - Domain blacklist: if `forbiddenNames` provided, none of those names
 *    appear as state-field or node names (anti-contamination check)
 */

type StateField = {
  name: string;
  type?: string;
  extractable?: boolean;
};

type InteractiveFlowNode = {
  name: string;
  nodeType: string;
  stateInputs?: string[];
  stateOutputs?: string[];
};

type IfSettings = {
  stateFields?: StateField[];
  nodes?: InteractiveFlowNode[];
  systemPrompt?: string;
  mcpGatewayId?: string;
  locale?: string;
};

type TriggerLike = {
  type?: string;
  settings?: IfSettings;
  nextAction?: TriggerLike;
};

export type StructuralExpectations = {
  stateFieldsMin: number;
  stateFieldsMax?: number;
  nodesMin: number;
  nodesMax?: number;
  confirmNodesExactly?: number;
  requiredNodeTypes?: Array<'TOOL' | 'USER_INPUT' | 'CONFIRM' | 'BRANCH'>;
  italianKeywordsMinMatch?: number;
  forbiddenNames?: string[];
};

export type StructuralResult = {
  ok: boolean;
  issues: string[];
  stats: {
    stateFields: number;
    nodes: number;
    nodesByType: Record<string, number>;
    hasConfirmedTriggerField: boolean;
    systemPromptLength: number;
    gatewaySet: boolean;
    locale: string | undefined;
  };
};

export function assertFlowStructural(params: {
  actual: TriggerLike | undefined;
  expect: StructuralExpectations;
}): StructuralResult {
  const settings = findIfSettings(params.actual);
  const issues: string[] = [];

  if (!settings) {
    return {
      ok: false,
      issues: ['no INTERACTIVE_FLOW action in flow'],
      stats: {
        stateFields: 0,
        nodes: 0,
        nodesByType: {},
        hasConfirmedTriggerField: false,
        systemPromptLength: 0,
        gatewaySet: false,
        locale: undefined,
      },
    };
  }

  const stateFields = settings.stateFields ?? [];
  const nodes = settings.nodes ?? [];

  if (stateFields.length < params.expect.stateFieldsMin) {
    issues.push(
      `stateFields count ${stateFields.length} < min ${params.expect.stateFieldsMin}`,
    );
  }
  if (
    params.expect.stateFieldsMax !== undefined &&
    stateFields.length > params.expect.stateFieldsMax
  ) {
    issues.push(
      `stateFields count ${stateFields.length} > max ${params.expect.stateFieldsMax}`,
    );
  }
  if (nodes.length < params.expect.nodesMin) {
    issues.push(`nodes count ${nodes.length} < min ${params.expect.nodesMin}`);
  }
  if (
    params.expect.nodesMax !== undefined &&
    nodes.length > params.expect.nodesMax
  ) {
    issues.push(`nodes count ${nodes.length} > max ${params.expect.nodesMax}`);
  }

  const nodesByType: Record<string, number> = {};
  for (const n of nodes) {
    nodesByType[n.nodeType] = (nodesByType[n.nodeType] ?? 0) + 1;
  }
  for (const required of params.expect.requiredNodeTypes ?? []) {
    if (!nodesByType[required] || nodesByType[required] < 1) {
      issues.push(`missing at least one ${required} node`);
    }
  }
  if (params.expect.confirmNodesExactly !== undefined) {
    const actual = nodesByType.CONFIRM ?? 0;
    if (actual !== params.expect.confirmNodesExactly) {
      issues.push(
        `expected exactly ${params.expect.confirmNodesExactly} CONFIRM nodes, got ${actual}`,
      );
    }
  }

  const confirmedField = stateFields.find((f) => f.name === 'confirmed');
  const hasConfirmedTriggerField =
    !!confirmedField &&
    confirmedField.type === 'boolean' &&
    confirmedField.extractable === true;
  if (!hasConfirmedTriggerField) {
    issues.push(
      'missing `confirmed` state field (boolean + extractable)',
    );
  }

  const systemPrompt = settings.systemPrompt ?? '';
  if (systemPrompt.trim().length < 100) {
    issues.push(
      `systemPrompt too short: ${systemPrompt.trim().length} chars (< 100)`,
    );
  }
  const italianKeywords = [
    'non inventare',
    'assistente',
    'cliente',
    'operatore',
    'italiano',
    'estrai',
    'conferma',
    'messaggio',
  ];
  const matches = italianKeywords.filter((k) =>
    systemPrompt.toLowerCase().includes(k.toLowerCase()),
  );
  const minMatch = params.expect.italianKeywordsMinMatch ?? 2;
  if (matches.length < minMatch) {
    issues.push(
      `systemPrompt must contain at least ${minMatch} Italian keywords, found ${matches.length}: ${matches.join(',')}`,
    );
  }

  if (!settings.mcpGatewayId) {
    issues.push('mcpGatewayId not set');
  }
  if (settings.locale !== 'it') {
    issues.push(`locale must be 'it', got '${settings.locale}'`);
  }

  for (const f of params.expect.forbiddenNames ?? []) {
    if (stateFields.some((s) => s.name === f)) {
      issues.push(`forbidden state-field name appears: ${f}`);
    }
    if (nodes.some((n) => n.name === f)) {
      issues.push(`forbidden node name appears: ${f}`);
    }
  }

  const topoIssues = checkTopological(stateFields, nodes);
  issues.push(...topoIssues);

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      stateFields: stateFields.length,
      nodes: nodes.length,
      nodesByType,
      hasConfirmedTriggerField,
      systemPromptLength: systemPrompt.length,
      gatewaySet: !!settings.mcpGatewayId,
      locale: settings.locale,
    },
  };
}

function findIfSettings(
  node: TriggerLike | undefined,
): IfSettings | undefined {
  if (!node) return undefined;
  if (node.type === 'INTERACTIVE_FLOW' && node.settings) return node.settings;
  if (node.nextAction) return findIfSettings(node.nextAction);
  return undefined;
}

function checkTopological(
  stateFields: StateField[],
  nodes: InteractiveFlowNode[],
): string[] {
  const declared = new Set(stateFields.map((f) => f.name));
  const writable = new Set<string>();
  for (const f of stateFields) {
    if (f.extractable === true) writable.add(f.name);
  }
  for (const n of nodes) {
    for (const out of n.stateOutputs ?? []) {
      writable.add(out);
    }
  }
  const issues: string[] = [];
  for (const n of nodes) {
    for (const inp of n.stateInputs ?? []) {
      if (!declared.has(inp)) {
        issues.push(`node ${n.name}: input "${inp}" not declared as stateField`);
      } else if (!writable.has(inp)) {
        issues.push(
          `node ${n.name}: input "${inp}" not produced by any node and not extractable`,
        );
      }
    }
  }
  return issues;
}
