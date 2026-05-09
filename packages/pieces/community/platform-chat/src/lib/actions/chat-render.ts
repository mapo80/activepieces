import { createAction, Property } from '@activepieces/pieces-framework';
import { platformChatAuth } from '../../index';

export const chatRenderAction = createAction({
  auth: platformChatAuth,
  name: 'chat-render',
  displayName: 'Render answer',
  description:
    'Render an output bubble in the conversation. Used by the Java agentic provider for AnswerInfo / VerifyRelationship / FinalReceipt commands. No waitpoint — fire-and-forget.',
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
    renderType: Property.StaticDropdown({
      displayName: 'Render type',
      required: true,
      defaultValue: 'answerInfo',
      options: {
        options: [
          { label: 'Information answer', value: 'answerInfo' },
          { label: 'Verification result', value: 'verifyRelationship' },
          { label: 'Account list', value: 'accountList' },
          { label: 'Reason catalog', value: 'reasonCatalog' },
          { label: 'Final receipt', value: 'finalReceipt' },
          { label: 'Generic markdown', value: 'markdown' },
        ],
      },
    }),
    title: Property.ShortText({
      displayName: 'Title',
      description: 'Optional heading shown above the body.',
      required: false,
    }),
    body: Property.LongText({
      displayName: 'Body',
      description: 'Markdown or plain-text body.',
      required: true,
    }),
    sourceFields: Property.Array({
      displayName: 'Source fields',
      description:
        'Run-data keys whose values are interpolated into the body via {{key}} placeholders.',
      required: false,
    }),
  },
  async run(context) {
    const { renderType, title, body, sourceFields } = context.propsValue;
    return {
      action: 'chat.render',
      renderType,
      title: title ?? null,
      body,
      sourceFields: sourceFields ?? [],
      renderedAt: new Date().toISOString(),
    };
  },
});
