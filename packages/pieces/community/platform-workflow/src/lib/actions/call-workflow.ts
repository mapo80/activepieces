import { createAction, Property } from '@activepieces/pieces-framework';
import { platformWorkflowAuth } from '../../index';

export const callWorkflowAction = createAction({
  auth: platformWorkflowAuth,
  name: 'call-workflow',
  displayName: 'Call sub-workflow',
  description:
    'Invoke a child agentic workflow synchronously. The Java agentic provider starts the sub-flow run, propagates the parent platformRunId for revision lineage, and waits for completion before continuing the parent run. Distinct from saga compensation (which runs on rollback).',
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
    childDefinitionId: Property.ShortText({
      displayName: 'Child workflow id',
      description:
        'definitionId of the child canonical workflow (resolved server-side via DefinitionRegistry).',
      required: true,
    }),
    childVersion: Property.ShortText({
      displayName: 'Child workflow version',
      required: true,
      defaultValue: '1.0',
    }),
    inputFields: Property.Array({
      displayName: 'Input fields',
      description:
        'Run-data keys forwarded from the parent run to the child workflow initialState.',
      required: false,
    }),
    outputFields: Property.Array({
      displayName: 'Output fields',
      description:
        'Run-data keys returned from the child final state and merged back into the parent run data.',
      required: false,
    }),
  },
  async run(context) {
    const { childDefinitionId, childVersion, inputFields, outputFields, platformNextStep, platformTerminal } = context.propsValue;
    return {
      action: 'workflow.callWorkflow',
      platformNextStep,
      platformTerminal: platformTerminal === true,
      childDefinitionId,
      childVersion: childVersion ?? '1.0',
      inputFields: inputFields ?? [],
      outputFields: outputFields ?? [],
      issuedAt: new Date().toISOString(),
    };
  },
});
