import { createAction, Property } from '@activepieces/pieces-framework';
import { platformWorkflowAuth } from '../../index';

export const waitEventAction = createAction({
  auth: platformWorkflowAuth,
  name: 'wait-event',
  displayName: 'Wait external event',
  description:
    'Pause the run until a named external event arrives via webhook. The Java agentic provider opens a WORKFLOW_WAIT_EVENT waitpoint; resumeRun() with the matching eventName completes it.',
  props: {
    eventName: Property.ShortText({
      displayName: 'Event name',
      description: 'Stable identifier for the external event the run is waiting on.',
      required: true,
    }),
    outputFields: Property.Array({
      displayName: 'Output fields',
      description: 'Run-data keys the event payload is expected to populate when it arrives.',
      required: true,
    }),
    timeoutSeconds: Property.Number({
      displayName: 'Waitpoint timeout (seconds)',
      description: 'How long the run waits before the waitpoint expires (default 600).',
      required: false,
      defaultValue: 600,
    }),
  },
  async run(context) {
    const { eventName, outputFields, timeoutSeconds } = context.propsValue;
    return {
      action: 'workflow.waitEvent',
      eventName,
      outputFields: outputFields ?? [],
      timeoutSeconds: timeoutSeconds ?? 600,
      issuedAt: new Date().toISOString(),
    };
  },
});
