import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { checkpointAction } from './lib/actions/checkpoint';
import { waitEventAction } from './lib/actions/wait-event';
import { sagaAction } from './lib/actions/saga';
import { callWorkflowAction } from './lib/actions/call-workflow';

export const platformWorkflowAuth = PieceAuth.None();

export const platformWorkflow = createPiece({
  displayName: '@platform/workflow',
  description:
    'Agentic Workflow Platform — workflow control actions: checkpoint barriers, external wait events, saga compensation. The Java agentic provider runs the actual logic; the piece is a thin descriptor.',
  auth: platformWorkflowAuth,
  minimumSupportedRelease: '0.0.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/workflow.png',
  authors: ['agentic-workflow-platform'],
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [checkpointAction, waitEventAction, sagaAction, callWorkflowAction],
  triggers: [],
});
