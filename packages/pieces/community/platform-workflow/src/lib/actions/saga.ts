import { createAction, Property } from '@activepieces/pieces-framework';
import { platformWorkflowAuth } from '../../index';

export const sagaAction = createAction({
  auth: platformWorkflowAuth,
  name: 'saga',
  displayName: 'Saga compensation',
  description:
    'Declare a compensation handler for a previous COMPENSATABLE step. If the run is cancelled or a downstream step fails, the Java agentic provider runs the named handler to roll back state.',
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
    compensationFor: Property.ShortText({
      displayName: 'Step to compensate',
      description: 'Step id whose effects this handler compensates.',
      required: true,
    }),
    handlerName: Property.ShortText({
      displayName: 'Handler name',
      description:
        'Logical name of the compensation routine (resolved server-side to a tool.call or chat.render action).',
      required: true,
    }),
    arguments: Property.Object({
      displayName: 'Handler arguments',
      description: 'Static or templated arguments passed to the handler at compensation time.',
      required: false,
    }),
  },
  async run(context) {
    const { compensationFor, handlerName, arguments: handlerArgs, platformNextStep, platformTerminal } = context.propsValue;
    return {
      action: 'workflow.saga',
      platformNextStep,
      platformTerminal: platformTerminal === true,
      compensationFor,
      handlerName,
      arguments: handlerArgs ?? {},
      registeredAt: new Date().toISOString(),
    };
  },
});
