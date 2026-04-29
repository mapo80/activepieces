import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { chatAskAction } from './lib/actions/chat-ask';
import { chatRenderAction } from './lib/actions/chat-render';
import { chatConfirmAction } from './lib/actions/chat-confirm';

export const platformChatAuth = PieceAuth.None();

export const platformChat = createPiece({
  displayName: '@platform/chat',
  description:
    'Agentic Workflow Platform — chat actions: ask user a question, render an answer, request confirmation. Each action proxies to the Java side via the agentic provider; no LLM logic lives inside the piece.',
  auth: platformChatAuth,
  minimumSupportedRelease: '0.0.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/chat-message.png',
  authors: ['agentic-workflow-platform'],
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [chatAskAction, chatRenderAction, chatConfirmAction],
  triggers: [],
});
