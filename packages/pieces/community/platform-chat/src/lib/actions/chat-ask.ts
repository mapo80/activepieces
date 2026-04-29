import { createAction, Property } from '@activepieces/pieces-framework';
import { platformChatAuth } from '../../index';

export const chatAskAction = createAction({
  auth: platformChatAuth,
  name: 'chat-ask',
  displayName: 'Ask user',
  description:
    'Pause the run, render a question to the user via the conversation channel, and wait for input. The Java agentic provider opens a waitpoint on the platform run; resuming injects the answer back as run data.',
  props: {
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
    const { promptText, fieldName, component, allowedValues, timeoutSeconds } = context.propsValue;
    return {
      action: 'chat.ask',
      promptText,
      outputField: fieldName,
      component: component ?? 'text-input',
      allowedValues: allowedValues ?? [],
      timeoutSeconds: timeoutSeconds ?? 600,
      issuedAt: new Date().toISOString(),
    };
  },
});
