import { createAction, Property } from '@activepieces/pieces-framework';
import { platformChatAuth } from '../../index';

export const chatRenderAction = createAction({
  auth: platformChatAuth,
  name: 'chat-render',
  displayName: 'Render answer',
  description:
    'Render an output bubble in the conversation. Used by the Java agentic provider for AnswerInfo / VerifyRelationship / FinalReceipt commands. No waitpoint — fire-and-forget.',
  props: {
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
