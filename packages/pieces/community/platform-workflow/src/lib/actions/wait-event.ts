import { createAction, Property } from '@activepieces/pieces-framework';
import { ExecutionType } from '@activepieces/shared';
import { platformWorkflowAuth } from '../../index';

export const waitEventAction = createAction({
  auth: platformWorkflowAuth,
  name: 'wait-event',
  displayName: 'Wait external event',
  description:
    'Pause the run until a named external event arrives via webhook. The Java agentic provider opens a WORKFLOW_WAIT_EVENT waitpoint; resumeRun() with the matching eventName completes it.',
  props: {
    platformCanonicalStepId: Property.ShortText({
      displayName: 'Platform canonical step id',
      description:
        'Stable canonical workflow step id used by the Java provider to translate AP runtime state back to the provider-agnostic RunState contract.',
      required: false,
    }),
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
    component: Property.ShortText({
      displayName: 'UI component',
      description: 'Optional renderer component used by the platform conversation UI.',
      required: false,
    }),
    promptHint: Property.LongText({
      displayName: 'Prompt hint',
      description: 'Human-readable explanation shown while the workflow waits.',
      required: false,
    }),
    platformNextStep: Property.ShortText({
      displayName: 'Platform next step',
      description:
        'Optional canonical AP step name to jump to when the waitpoint resumes.',
      required: false,
    }),
    platformTerminal: Property.Checkbox({
      displayName: 'Platform terminal step',
      description: 'When true, the generated platform runtime stops after this action.',
      required: false,
      defaultValue: false,
    }),
    timeoutSeconds: Property.Number({
      displayName: 'Waitpoint timeout (seconds)',
      description: 'How long the run waits before the waitpoint expires (default 600).',
      required: false,
      defaultValue: 600,
    }),
  },
  async run(context) {
    const {
      eventName,
      outputFields,
      component,
      promptHint,
      platformNextStep,
      platformTerminal,
      timeoutSeconds,
    } = context.propsValue;
    if (context.executionType === ExecutionType.RESUME) {
      const values = readResumeValues(context.resumePayload, outputFields);
      return {
        action: 'workflow.waitEvent.completed',
        eventName,
        outputFields: outputFields ?? [],
        ...values,
        platformSourceTurnId: readSourceTurnId(context.resumePayload),
        platformNextStep,
        platformTerminal: platformTerminal === true,
        resumedAt: new Date().toISOString(),
      };
    }

    const waitpoint = await context.run.createWaitpoint({
      type: 'WEBHOOK',
      responseToSend: {
        status: 200,
        body: {
          action: 'workflow.waitEvent',
          eventName,
          outputFields: outputFields ?? [],
          component: component ?? 'text-input',
          promptText: promptHint ?? '',
          summary: promptHint ?? '',
        },
      },
    });
    context.run.waitForWaitpoint(waitpoint.id);
    return {
      action: 'workflow.waitEvent',
      waitpointId: waitpoint.id,
      resumeUrl: waitpoint.resumeUrl,
      eventName,
      outputFields: outputFields ?? [],
      component: component ?? 'text-input',
      promptText: promptHint ?? '',
      timeoutSeconds: timeoutSeconds ?? 600,
      issuedAt: new Date().toISOString(),
    };
  },
});

function readResumeValues(resumePayload: unknown, outputFields: unknown): Record<string, unknown> {
  const payload = asRecord(resumePayload);
  const body = asRecord(payload.body);
  const nestedPayload = asRecord(body.payload);
  const queryParams = asRecord(payload.queryParams);
  const fields = Array.isArray(outputFields) ? outputFields.map(String) : [];
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field] = firstDefined(
      body[field],
      nestedPayload[field],
      queryParams[field],
      body.value,
      body.answer,
      queryParams.value,
      queryParams.answer,
    );
  }
  return values;
}

function readSourceTurnId(resumePayload: unknown): string | undefined {
  const payload = asRecord(resumePayload);
  const body = asRecord(payload.body);
  const nestedPayload = asRecord(body.payload);
  const queryParams = asRecord(payload.queryParams);
  return stringOrUndefined(firstDefined(
    body.sourceTurnId,
    nestedPayload.sourceTurnId,
    body.turnId,
    nestedPayload.turnId,
    queryParams.sourceTurnId,
    queryParams.turnId,
  ));
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
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
