// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { interactiveFlowTemplates } from './index';

describe('interactiveFlowTemplates', () => {
  it('ships the 3 canonical templates', () => {
    const names = interactiveFlowTemplates.list().map((t) => t.name);
    expect(names).toEqual([
      'customer-onboarding',
      'approval-chain',
      'data-enrichment',
    ]);
  });

  it('each template has nodes whose stateInputs reference declared stateFields', () => {
    for (const tpl of interactiveFlowTemplates.list()) {
      const declared = new Set(tpl.settings.stateFields.map((f) => f.name));
      for (const node of tpl.settings.nodes) {
        for (const input of node.stateInputs ?? []) {
          expect(declared.has(input)).toBe(true);
        }
      }
    }
  });

  it('each template has at least one USER_INPUT node (otherwise the flow cannot pause)', () => {
    for (const tpl of interactiveFlowTemplates.list()) {
      const hasUserInput = tpl.settings.nodes.some(
        (n) => n.nodeType === 'USER_INPUT',
      );
      expect(hasUserInput).toBe(true);
    }
  });

  it('getByName returns the correct template and undefined for unknown names', () => {
    expect(
      interactiveFlowTemplates.getByName('approval-chain')?.displayName,
    ).toBe('Approval Chain');
    expect(interactiveFlowTemplates.getByName('nope')).toBeUndefined();
  });
});
