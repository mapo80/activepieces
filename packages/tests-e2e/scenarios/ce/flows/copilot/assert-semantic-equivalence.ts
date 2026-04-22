/**
 * Semantic-equivalence assertion for Copilot reproducibility tests.
 *
 * Checks that an actual FlowVersion produced by the Copilot matches a
 * reference (e.g. estinzione.json) under a "superset" relaxation:
 * extra fields/nodes are OK, missing ones are not.
 *
 * See plan section "Checklist semantica (normativa)" for the 10-point
 * contract enforced here.
 */

type StateField = {
  name: string;
  type?: string;
  extractable?: boolean;
  enumFrom?: string;
  enumValueField?: string;
  pattern?: string;
  parser?: string;
  label?: Record<string, string>;
  description?: string;
};

type InteractiveNode = {
  id?: string;
  name: string;
  nodeType: string;
  stateInputs?: string[];
  stateOutputs?: string[];
  tool?: string;
  toolParams?: Record<string, unknown>;
  singleOptionStrategy?: string;
  render?: { component?: string; props?: Record<string, unknown> };
};

type IfSettings = {
  nodes?: InteractiveNode[];
  stateFields?: StateField[];
  systemPrompt?: string;
  messageInput?: string;
  sessionIdInput?: string;
  locale?: string;
  mcpGatewayId?: string;
};

type FlowLike = {
  trigger?: { nextAction?: unknown };
};

export type SemanticDiff = {
  missingStateFields: string[];
  wrongStateFields: Array<{
    name: string;
    reason: string;
    expected?: Partial<StateField>;
    actual?: Partial<StateField>;
  }>;
  missingNodes: string[];
  wrongNodes: Array<{ name: string; reason: string }>;
  missingRenderComponents: Array<{ node: string; expected: string }>;
  graphIssues: string[];
  settingsIssues: string[];
};

export type SemanticResult = {
  ok: boolean;
  diff: SemanticDiff;
  feedbackMessage: string;
};

export type AssertParams = {
  actual: FlowLike | { nextAction?: unknown };
  expected: FlowLike | { nextAction?: unknown };
  mode?: 'superset' | 'strict';
};

const EXPECTED_RENDER = new Map<string, string>([
  ['pick_ndg', 'DataTable'],
  ['pick_rapporto', 'DataTable'],
  ['collect_reason', 'DataTable'],
  ['collect_date', 'DatePickerCard'],
  ['confirm_closure', 'ConfirmCard'],
]);

const SYSTEM_PROMPT_PHRASES = [
  'estinzione',
  'non inventare',
  'customerName',
  'ndg',
  'closureReasonCode',
  'confirmed',
];

function extractIfSettings(flow: AssertParams['actual']): IfSettings | null {
  const trigger = (flow as FlowLike).trigger ?? (flow as { nextAction?: unknown });
  let cursor: unknown = (trigger as { nextAction?: unknown }).nextAction ?? trigger;
  while (cursor && typeof cursor === 'object') {
    const step = cursor as {
      type?: string;
      settings?: IfSettings;
      nextAction?: unknown;
    };
    if (step.type === 'INTERACTIVE_FLOW' && step.settings) return step.settings;
    cursor = step.nextAction;
  }
  return null;
}

function countMatches(text: string, phrases: string[]): number {
  const lower = text.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase())).length;
}

function checkStateFields(
  expected: StateField[],
  actual: StateField[],
): { missing: string[]; wrong: SemanticDiff['wrongStateFields'] } {
  const byName = new Map(actual.map((f) => [f.name, f]));
  const missing: string[] = [];
  const wrong: SemanticDiff['wrongStateFields'] = [];
  for (const expField of expected) {
    const actField = byName.get(expField.name);
    if (!actField) {
      missing.push(expField.name);
      continue;
    }
    if (expField.type && actField.type !== expField.type) {
      wrong.push({
        name: expField.name,
        reason: `type deve essere "${expField.type}", trovato "${actField.type ?? '?'}"`,
      });
    }
    if (expField.extractable !== undefined && actField.extractable !== expField.extractable) {
      wrong.push({
        name: expField.name,
        reason: `extractable deve essere ${expField.extractable}`,
      });
    }
    if (expField.enumFrom && actField.enumFrom !== expField.enumFrom) {
      wrong.push({
        name: expField.name,
        reason: `deve essere collegato al catalogo "${expField.enumFrom}"`,
      });
    }
    if (expField.enumValueField && actField.enumValueField !== expField.enumValueField) {
      wrong.push({
        name: expField.name,
        reason: `la chiave di confronto nel catalogo deve essere "${expField.enumValueField}"`,
      });
    }
    if (expField.pattern && actField.pattern !== expField.pattern) {
      wrong.push({
        name: expField.name,
        reason: `il pattern di formato deve essere "${expField.pattern}"`,
      });
    }
    if (expField.parser && actField.parser !== expField.parser) {
      wrong.push({
        name: expField.name,
        reason: `il parser deve essere "${expField.parser}"`,
      });
    }
    if (expField.label && !actField.label) {
      wrong.push({
        name: expField.name,
        reason: `manca l'etichetta user-friendly`,
      });
    }
    if (!actField.description || actField.description.trim().length === 0) {
      wrong.push({
        name: expField.name,
        reason: `manca la descrizione business`,
      });
    }
  }
  return { missing, wrong };
}

function checkNodes(
  expected: InteractiveNode[],
  actual: InteractiveNode[],
): { missing: string[]; wrong: SemanticDiff['wrongNodes']; missingRender: SemanticDiff['missingRenderComponents'] } {
  const byName = new Map(actual.map((n) => [n.name, n]));
  const missing: string[] = [];
  const wrong: SemanticDiff['wrongNodes'] = [];
  const missingRender: SemanticDiff['missingRenderComponents'] = [];
  for (const expNode of expected) {
    const actNode = byName.get(expNode.name);
    if (!actNode) {
      missing.push(expNode.name);
      continue;
    }
    if (actNode.nodeType !== expNode.nodeType) {
      wrong.push({
        name: expNode.name,
        reason: `il tipo di nodo deve essere "${expNode.nodeType}"`,
      });
    }
    const expIn = new Set(expNode.stateInputs ?? []);
    const actIn = new Set(actNode.stateInputs ?? []);
    if (expIn.size !== actIn.size || [...expIn].some((x) => !actIn.has(x))) {
      wrong.push({
        name: expNode.name,
        reason: `i dati in ingresso devono essere [${[...expIn].join(', ')}]`,
      });
    }
    const expOut = new Set(expNode.stateOutputs ?? []);
    const actOut = new Set(actNode.stateOutputs ?? []);
    if (expOut.size !== actOut.size || [...expOut].some((x) => !actOut.has(x))) {
      wrong.push({
        name: expNode.name,
        reason: `i dati in uscita devono essere [${[...expOut].join(', ')}]`,
      });
    }
    const expectedRender = EXPECTED_RENDER.get(expNode.name);
    if (expectedRender && actNode.render?.component !== expectedRender) {
      missingRender.push({ node: expNode.name, expected: expectedRender });
    }
  }
  return { missing, wrong, missingRender };
}

function checkGraph(nodes: InteractiveNode[]): string[] {
  const issues: string[] = [];
  const produced = new Set<string>();
  for (const n of nodes) {
    for (const inp of n.stateInputs ?? []) {
      if (!produced.has(inp) && !['customerName'].includes(inp)) {
        issues.push(`il passo "${n.name}" richiede "${inp}" che non è ancora stato prodotto`);
      }
    }
    for (const out of n.stateOutputs ?? []) {
      produced.add(out);
    }
  }
  return issues;
}

function buildFeedback(diff: SemanticDiff): string {
  const lines: string[] = [];
  if (diff.missingStateFields.length) {
    lines.push(`- Campi dati mancanti: ${diff.missingStateFields.join('; ')}`);
  }
  if (diff.missingNodes.length) {
    lines.push(`- Passi mancanti: ${diff.missingNodes.join('; ')}`);
  }
  for (const mr of diff.missingRenderComponents) {
    lines.push(`- Per il passo "${mr.node}", serve il componente visivo: ${mr.expected}`);
  }
  for (const ws of diff.wrongStateFields) {
    lines.push(`- Il campo "${ws.name}": ${ws.reason}`);
  }
  for (const wn of diff.wrongNodes) {
    lines.push(`- Il passo "${wn.name}": ${wn.reason}`);
  }
  for (const si of diff.settingsIssues) {
    lines.push(`- Impostazione generale: ${si}`);
  }
  for (const gi of diff.graphIssues) {
    lines.push(`- Problema nella sequenza dei passi: ${gi}`);
  }
  if (lines.length === 0) return '';
  return [
    `Il flow che hai generato è quasi corretto ma mancano alcune cose. Correggi:`,
    ...lines,
    `Rigenera solo le parti mancanti/errate, non toccare il resto.`,
  ].join('\n');
}

export function assertFlowSemanticallyEquivalent(params: AssertParams): SemanticResult {
  const actualSettings = extractIfSettings(params.actual);
  const expectedSettings = extractIfSettings(params.expected);
  const diff: SemanticDiff = {
    missingStateFields: [],
    wrongStateFields: [],
    missingNodes: [],
    wrongNodes: [],
    missingRenderComponents: [],
    graphIssues: [],
    settingsIssues: [],
  };
  if (!actualSettings) {
    diff.settingsIssues.push('nessuna azione INTERACTIVE_FLOW trovata');
    return { ok: false, diff, feedbackMessage: buildFeedback(diff) };
  }
  if (!expectedSettings) {
    throw new Error('expected flow has no INTERACTIVE_FLOW settings');
  }

  if (!actualSettings.mcpGatewayId) diff.settingsIssues.push('manca il collegamento alla banca (mcpGatewayId)');
  if (!actualSettings.messageInput) diff.settingsIssues.push('manca il binding del messaggio');
  if (!actualSettings.sessionIdInput) diff.settingsIssues.push('manca il binding della sessione');
  if (actualSettings.locale !== 'it') diff.settingsIssues.push('la lingua deve essere italiano');

  const systemPrompt = actualSettings.systemPrompt ?? '';
  if (countMatches(systemPrompt, SYSTEM_PROMPT_PHRASES) < 4) {
    diff.settingsIssues.push('il testo guida dell\'assistente deve includere le regole fondamentali (cliente, rapporto, motivazione, conferma)');
  }

  const fieldCheck = checkStateFields(
    expectedSettings.stateFields ?? [],
    actualSettings.stateFields ?? [],
  );
  diff.missingStateFields.push(...fieldCheck.missing);
  diff.wrongStateFields.push(...fieldCheck.wrong);

  const nodeCheck = checkNodes(
    expectedSettings.nodes ?? [],
    actualSettings.nodes ?? [],
  );
  diff.missingNodes.push(...nodeCheck.missing);
  diff.wrongNodes.push(...nodeCheck.wrong);
  diff.missingRenderComponents.push(...nodeCheck.missingRender);

  diff.graphIssues.push(...checkGraph(actualSettings.nodes ?? []));

  const ok =
    diff.missingStateFields.length === 0 &&
    diff.wrongStateFields.length === 0 &&
    diff.missingNodes.length === 0 &&
    diff.wrongNodes.length === 0 &&
    diff.missingRenderComponents.length === 0 &&
    diff.graphIssues.length === 0 &&
    diff.settingsIssues.length === 0;

  return {
    ok,
    diff,
    feedbackMessage: buildFeedback(diff),
  };
}
