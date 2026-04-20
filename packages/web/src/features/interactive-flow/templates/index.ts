import { InteractiveFlowActionSettings } from '@activepieces/shared';

import approvalChain from './approval-chain.json';
import customerOnboarding from './customer-onboarding.json';
import dataEnrichment from './data-enrichment.json';

export type InteractiveFlowTemplate = {
  name: string;
  displayName: string;
  description: string;
  settings: InteractiveFlowActionSettings;
};

function asTemplate(tpl: Record<string, unknown>): InteractiveFlowTemplate {
  const settings: InteractiveFlowActionSettings = {
    nodes: tpl.nodes as InteractiveFlowActionSettings['nodes'],
    stateFields:
      tpl.stateFields as InteractiveFlowActionSettings['stateFields'],
    greeting: tpl.greeting as InteractiveFlowActionSettings['greeting'],
    locale: tpl.locale as InteractiveFlowActionSettings['locale'],
    systemPrompt:
      tpl.systemPrompt as InteractiveFlowActionSettings['systemPrompt'],
  };
  return {
    name: tpl.name as string,
    displayName: tpl.displayName as string,
    description: tpl.description as string,
    settings,
  };
}

const templates: InteractiveFlowTemplate[] = [
  asTemplate(customerOnboarding),
  asTemplate(approvalChain),
  asTemplate(dataEnrichment),
];

export const interactiveFlowTemplates = {
  list: (): InteractiveFlowTemplate[] => templates,
  getByName: (name: string): InteractiveFlowTemplate | undefined =>
    templates.find((t) => t.name === name),
};
