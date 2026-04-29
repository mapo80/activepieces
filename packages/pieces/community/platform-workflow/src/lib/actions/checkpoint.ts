import { createAction, Property } from '@activepieces/pieces-framework';
import { platformWorkflowAuth } from '../../index';

export const checkpointAction = createAction({
  auth: platformWorkflowAuth,
  name: 'checkpoint',
  displayName: 'Checkpoint',
  description:
    'Mark a checkpoint in the workflow run. Adds the listed barrier names to RunState.barriersReached and emits a RunStateSnapshot. Used to gate IRREVERSIBLE downstream steps (e.g. submit_closure requires pre_submit_confirmation).',
  props: {
    checkpointId: Property.ShortText({
      displayName: 'Checkpoint id',
      description: 'Stable id used by reviseRun() to seek back to this point.',
      required: true,
    }),
    barriers: Property.Array({
      displayName: 'Barriers reached',
      description:
        'Barrier names that the run satisfies at this point (e.g. pre_submit_confirmation).',
      required: false,
    }),
    revisionable: Property.Checkbox({
      displayName: 'Revisionable',
      description:
        'When true, reviseRun() can seek back to this checkpoint to re-run downstream steps.',
      required: false,
      defaultValue: false,
    }),
  },
  async run(context) {
    const { checkpointId, barriers, revisionable } = context.propsValue;
    return {
      action: 'workflow.checkpoint',
      checkpointId,
      barriers: barriers ?? [],
      revisionable: revisionable ?? false,
      reachedAt: new Date().toISOString(),
    };
  },
});
