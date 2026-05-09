import { createAction, Property } from '@activepieces/pieces-framework';
import { ExecutionType } from '@activepieces/shared';
import { platformChatAuth } from '../../index';

export const chatAskAction = createAction({
  auth: platformChatAuth,
  name: 'chat-ask',
  displayName: 'Ask user',
  description:
    'Pause the run, render a question to the user via the conversation channel, and wait for input. The Java agentic provider opens a waitpoint on the platform run; resuming injects the answer back as run data.',
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
    promptText: Property.LongText({
      displayName: 'Prompt',
      description: 'The text shown to the user (supports template substitution from run data).',
      required: true,
    }),
    fieldName: Property.ShortText({
      displayName: 'Output field',
      description: 'Run-data key under which the user answer is stored once the waitpoint resumes.',
      required: true,
    }),
    existingValue: Property.LongText({
      displayName: 'Existing value',
      description:
        'Optional resolved value from previous AP steps or trigger payload. When present, the step is satisfied without opening a waitpoint.',
      required: false,
    }),
    component: Property.StaticDropdown({
      displayName: 'UI component',
      description:
        'Hint to the conversation renderer about which input widget to use (free-text, choice list, date, etc.). The renderer is governed by the platform UI layer.',
      required: false,
      defaultValue: 'text-input',
      options: {
        options: [
          { label: 'Free text', value: 'text-input' },
          { label: 'Choice list', value: 'choice-list' },
          { label: 'Date', value: 'date-picker' },
          { label: 'Number', value: 'number-input' },
        ],
      },
    }),
    allowedValues: Property.Array({
      displayName: 'Allowed values',
      description:
        'When component=choice-list, the closed list of acceptable answers. Ignored otherwise.',
      required: false,
    }),
    timeoutSeconds: Property.Number({
      displayName: 'Waitpoint timeout (seconds)',
      description: 'How long the run waits before the waitpoint expires (default 600).',
      required: false,
      defaultValue: 600,
    }),
  },
  async run(context) {
    const { promptText, fieldName, existingValue, component, allowedValues, timeoutSeconds } = context.propsValue;
    if (context.executionType === ExecutionType.RESUME) {
      const value = readResumeValue(context.resumePayload, fieldName);
      return {
        action: 'chat.ask.completed',
        outputField: fieldName,
        value,
        [fieldName]: value,
        platformSourceTurnId: readSourceTurnId(context.resumePayload),
        resumedAt: new Date().toISOString(),
      };
    }

    const resolved = normalizeExistingValue(existingValue);
    if (resolved !== undefined) {
      return {
        action: 'chat.ask.completed',
        outputField: fieldName,
        value: resolved,
        [fieldName]: resolved,
        skippedWaitpoint: true,
        completedAt: new Date().toISOString(),
      };
    }

    const waitpoint = await context.run.createWaitpoint({
      type: 'WEBHOOK',
      responseToSend: {
        status: 200,
        body: {
          action: 'chat.ask',
          promptText,
          outputField: fieldName,
          component: component ?? 'text-input',
          allowedValues: allowedValues ?? [],
        },
      },
    });
    context.run.waitForWaitpoint(waitpoint.id);
    return {
      action: 'chat.ask',
      waitpointId: waitpoint.id,
      resumeUrl: waitpoint.resumeUrl,
      promptText,
      outputField: fieldName,
      component: component ?? 'text-input',
      allowedValues: allowedValues ?? [],
      timeoutSeconds: timeoutSeconds ?? 600,
      issuedAt: new Date().toISOString(),
    };
  },
});

function readResumeValue(resumePayload: unknown, fieldName: string): unknown {
  const payload = asRecord(resumePayload);
  const body = asRecord(payload.body);
  const nestedPayload = asRecord(body.payload);
  const queryParams = asRecord(payload.queryParams);
  return firstDefined(
    body[fieldName],
    nestedPayload[fieldName],
    body.value,
    body.answer,
    queryParams[fieldName],
    queryParams.value,
    queryParams.answer,
  );
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

function normalizeExistingValue(value: unknown): unknown | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value : undefined;
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0 ? value : undefined;
  }
  const text = String(value).trim();
  if (
    text.length === 0 ||
    text === "''" ||
    ['null', 'undefined', '[object Object]'].includes(text.toLowerCase())
  ) {
    return undefined;
  }
  return text;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length === 0 ? undefined : text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
