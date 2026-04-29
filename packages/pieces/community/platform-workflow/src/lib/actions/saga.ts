import { createAction, Property } from '@activepieces/pieces-framework';
import { platformWorkflowAuth } from '../../index';

export const sagaAction = createAction({
  auth: platformWorkflowAuth,
  name: 'saga',
  displayName: 'Saga compensation',
  description:
    'Declare a compensation handler for a previous COMPENSATABLE step. If the run is cancelled or a downstream step fails, the Java agentic provider runs the named handler to roll back state.',
  props: {
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
    const { compensationFor, handlerName, arguments: handlerArgs } = context.propsValue;
    return {
      action: 'workflow.saga',
      compensationFor,
      handlerName,
      arguments: handlerArgs ?? {},
      registeredAt: new Date().toISOString(),
    };
  },
});
