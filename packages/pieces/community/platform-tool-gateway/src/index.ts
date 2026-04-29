import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { toolCallAction } from './lib/actions/tool-call';

export const platformToolGatewayAuth = PieceAuth.None();

export const platformToolGateway = createPiece({
  displayName: '@platform/tool-gateway',
  description:
    'Agentic Workflow Platform — invoke MCP tools via the governed Tool Gateway. The piece declares { mcpGatewayId, toolRef, payload }; the Java agentic provider executes the 10-step orchestration (lifecycle, allowlist, schema, PEP, idempotency, audit, cost) before reaching the MCP server. No tool call ever bypasses governance.',
  auth: platformToolGatewayAuth,
  minimumSupportedRelease: '0.0.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/tool.png',
  authors: ['agentic-workflow-platform'],
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [toolCallAction],
  triggers: [],
});
