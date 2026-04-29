import { createAction, Property } from '@activepieces/pieces-framework';
import { platformChatAuth } from '../../index';

export const chatConfirmAction = createAction({
  auth: platformChatAuth,
  name: 'chat-confirm',
  displayName: 'Ask confirmation',
  description:
    'Block the run with a confirm/reject dialog. Used to satisfy the pre_submit_confirmation barrier before any IRREVERSIBLE tool.call. The waitpoint resumes once the operator clicks confirm or reject.',
  props: {
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
  },
  async run(context) {
    const { summary, barrierName, confirmLabel, rejectLabel, fieldName } = context.propsValue;
    return {
      action: 'chat.confirm',
      summary,
      barrierName: barrierName ?? 'pre_submit_confirmation',
      confirmLabel: confirmLabel ?? 'Confirm',
      rejectLabel: rejectLabel ?? 'Cancel',
      outputField: fieldName ?? 'confirmed',
      issuedAt: new Date().toISOString(),
    };
  },
});
