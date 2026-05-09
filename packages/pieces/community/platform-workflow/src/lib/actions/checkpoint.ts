import { createAction, Property } from '@activepieces/pieces-framework';
import { platformWorkflowAuth } from '../../index';

export const checkpointAction = createAction({
  auth: platformWorkflowAuth,
  name: 'checkpoint',
  displayName: 'Checkpoint',
  description:
    'Mark a checkpoint in the workflow run. Adds the listed barrier names to RunState.barriersReached and emits a RunStateSnapshot. Used to gate IRREVERSIBLE downstream steps (e.g. submit_closure requires pre_submit_confirmation).',
  props: {
    platformCanonicalStepId: Property.ShortText({
      displayName: 'Platform canonical step id',
      description:
        'Stable canonical workflow step id used by the Java provider to translate AP runtime state back to the provider-agnostic RunState contract.',
      required: false,
    }),
    platformNextStep: Property.ShortText({
      displayName: 'Platform next step',
      description: 'Optional generated runtime jump target after this action completes.',
      required: false,
    }),
    platformTerminal: Property.Checkbox({
      displayName: 'Platform terminal step',
      description: 'When true, the generated platform runtime stops after this action.',
      required: false,
      defaultValue: false,
    }),
    checkpointId: Property.ShortText({
      displayName: 'Checkpoint id',
      description: 'Stable id used by reviseRun() to seek back to this point.',
      required: true,
    }),
    barriers: Property.Array({
      displayName: 'Barriers reached',
      description:
        'Barrier names that the run satisfies at this point (e.g. pre_submit_confirmation).',
      required: false,
    }),
    branches: Property.Array({
      displayName: 'Branches',
      description:
        'Canonical branch descriptors. Each item can declare condition/default and next; the AP engine will jump to the selected next step.',
      required: false,
    }),
    bindingData: Property.Object({
      displayName: 'Canonical binding data',
      description:
        'Resolved workflow data used to evaluate provider-agnostic branch conditions.',
      required: false,
    }),
    revisionable: Property.Checkbox({
      displayName: 'Revisionable',
      description:
        'When true, reviseRun() can seek back to this checkpoint to re-run downstream steps.',
      required: false,
      defaultValue: false,
    }),
  },
  async run(context) {
    const { checkpointId, barriers, branches, bindingData, revisionable } = context.propsValue;
    const selectedBranch = selectBranch(branches, bindingData);
    return {
      action: 'workflow.checkpoint',
      checkpointId,
      barriers: barriers ?? [],
      branches: normalizeBranches(branches),
      platformNextStep: selectedBranch?.next,
      selectedBranch: selectedBranch?.index,
      revisionable: revisionable ?? false,
      reachedAt: new Date().toISOString(),
    };
  },
});

type BranchDescriptor = {
  condition?: string;
  default?: boolean;
  next?: string;
};

function normalizeBranches(value: unknown): BranchDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => ({
      condition: stringOrUndefined(item.condition),
      default: item.default === true || String(item.default ?? '').toLowerCase() === 'true',
      next: stringOrUndefined(item.next),
    }));
}

function selectBranch(branches: unknown, data: unknown): { index: number; next?: string } | undefined {
  const normalized = normalizeBranches(branches);
  const values = asRecord(data);
  let defaultBranch: { index: number; next?: string } | undefined;
  for (let i = 0; i < normalized.length; i++) {
    const branch = normalized[i];
    if (branch.default === true) {
      defaultBranch = { index: i, next: branch.next };
      continue;
    }
    if (branch.condition && evaluateCondition(branch.condition, values)) {
      return { index: i, next: branch.next };
    }
  }
  return defaultBranch;
}

function evaluateCondition(condition: string, values: Record<string, unknown>): boolean {
  const equalityMatch = condition.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*'([^']*)'\s*$/);
  if (equalityMatch) {
    const [, field, operator, expected] = equalityMatch;
    const actual = normalizeComparable(values[field]);
    const expectedValue = normalizeComparable(expected);
    return operator === '==' ? actual === expectedValue : actual !== expectedValue;
  }

  const numericMatch = condition.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (numericMatch) {
    const [, field, operator, expectedText] = numericMatch;
    const actual = numericValue(values[field]);
    if (actual === undefined) {
      return false;
    }
    const expected = Number(expectedText);
    switch (operator) {
      case '>':
        return actual > expected;
      case '>=':
        return actual >= expected;
      case '<':
        return actual < expected;
      case '<=':
        return actual <= expected;
      default:
        return false;
    }
  }

  const existsMatch = condition.match(/^\s*exists\(([A-Za-z_][A-Za-z0-9_]*)\)\s*$/);
  if (existsMatch) {
    return !isMissing(values[existsMatch[1]]);
  }

  const missingMatch = condition.match(/^\s*missing\(([A-Za-z_][A-Za-z0-9_]*)\)\s*$/);
  if (missingMatch) {
    return isMissing(values[missingMatch[1]]);
  }

  return false;
}

function normalizeComparable(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return String(value ?? '').trim();
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length === 0 ? undefined : text;
}
