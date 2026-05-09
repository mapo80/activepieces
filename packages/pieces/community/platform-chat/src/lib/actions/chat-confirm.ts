import { createAction, Property } from '@activepieces/pieces-framework';
import { ExecutionType } from '@activepieces/shared';
import { platformChatAuth } from '../../index';

export const chatConfirmAction = createAction({
  auth: platformChatAuth,
  name: 'chat-confirm',
  displayName: 'Ask confirmation',
  description:
    'Block the run with a confirm/reject dialog. Used to satisfy the pre_submit_confirmation barrier before any IRREVERSIBLE tool.call. The waitpoint resumes once the operator clicks confirm or reject.',
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
    summary: Property.LongText({
      displayName: 'Operation summary',
      description: 'Human-readable description of what is about to be submitted.',
      required: true,
    }),
    barrierName: Property.ShortText({
      displayName: 'Barrier to mark',
      description:
        'When confirmed, this barrier name is added to RunState.barriersReached. Default: pre_submit_confirmation.',
      required: false,
      defaultValue: 'pre_submit_confirmation',
    }),
    confirmLabel: Property.ShortText({
      displayName: 'Confirm button label',
      required: false,
      defaultValue: 'Confirm',
    }),
    rejectLabel: Property.ShortText({
      displayName: 'Reject button label',
      required: false,
      defaultValue: 'Cancel',
    }),
    fieldName: Property.ShortText({
      displayName: 'Output field',
      description:
        'Run-data key under which the boolean confirmation result is stored (true=confirmed, false=rejected).',
      required: false,
      defaultValue: 'confirmed',
    }),
    existingValue: Property.LongText({
      displayName: 'Existing value',
      description:
        'Optional resolved confirmation value from previous AP steps or trigger payload. When present, the confirmation waitpoint is skipped.',
      required: false,
    }),
  },
  async run(context) {
    const { summary, barrierName, confirmLabel, rejectLabel, fieldName, existingValue } = context.propsValue;
    const outputField = fieldName ?? 'confirmed';
    if (context.executionType === ExecutionType.RESUME) {
      const confirmed = readConfirmation(context.resumePayload, outputField);
      return {
        action: 'chat.confirm.completed',
        barrierName: barrierName ?? 'pre_submit_confirmation',
        outputField,
        confirmed,
        [outputField]: confirmed,
        platformSourceTurnId: readSourceTurnId(context.resumePayload),
        barriersReached: confirmed ? [barrierName ?? 'pre_submit_confirmation'] : [],
        resumedAt: new Date().toISOString(),
      };
    }

    const resolved = normalizeExistingConfirmation(existingValue);
    if (resolved !== undefined) {
      return {
        action: 'chat.confirm.completed',
        barrierName: barrierName ?? 'pre_submit_confirmation',
        outputField,
        confirmed: resolved,
        [outputField]: resolved,
        barriersReached: resolved ? [barrierName ?? 'pre_submit_confirmation'] : [],
        skippedWaitpoint: true,
        completedAt: new Date().toISOString(),
      };
    }

    const waitpoint = await context.run.createWaitpoint({
      type: 'WEBHOOK',
      responseToSend: {
        status: 200,
        body: {
          action: 'chat.confirm',
          summary,
          barrierName: barrierName ?? 'pre_submit_confirmation',
          confirmLabel: confirmLabel ?? 'Confirm',
          rejectLabel: rejectLabel ?? 'Cancel',
          outputField,
        },
      },
    });
    context.run.waitForWaitpoint(waitpoint.id);
    return {
      action: 'chat.confirm',
      waitpointId: waitpoint.id,
      resumeUrl: waitpoint.resumeUrl,
      summary,
      barrierName: barrierName ?? 'pre_submit_confirmation',
      confirmLabel: confirmLabel ?? 'Confirm',
      rejectLabel: rejectLabel ?? 'Cancel',
      outputField,
      issuedAt: new Date().toISOString(),
    };
  },
});

function readConfirmation(resumePayload: unknown, outputField: string): boolean {
  const payload = asRecord(resumePayload);
  const body = asRecord(payload.body);
  const nestedPayload = asRecord(body.payload);
  const queryParams = asRecord(payload.queryParams);
  const raw = firstDefined(
    body[outputField],
    nestedPayload[outputField],
    body.confirmed,
    nestedPayload.confirmed,
    body.confirmationGiven,
    nestedPayload.confirmationGiven,
    body.value,
    queryParams[outputField],
    queryParams.confirmed,
    queryParams.confirmationGiven,
    queryParams.action,
  );
  if (typeof raw === 'boolean') {
    return raw;
  }
  const normalized = String(raw ?? '').trim().toLowerCase();
  return ['true', 'yes', 'y', 'si', 'sì', 'ok', 'confirm', 'confirmed', 'approve', 'approved'].includes(normalized);
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

function normalizeExistingConfirmation(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized.length === 0 || ['null', 'undefined'].includes(normalized)) {
    return undefined;
  }
  if (['true', 'yes', 'y', 'si', 'sì', 'ok', 'confirm', 'confirmed', 'approve', 'approved'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', 'n', 'cancel', 'cancelled', 'reject', 'rejected'].includes(normalized)) {
    return false;
  }
  return undefined;
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
