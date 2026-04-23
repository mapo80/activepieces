import { FlowVersion } from '@activepieces/shared';
import React from 'react';

const CopilotPanelLazy = React.lazy(() =>
  import('./copilot-panel').then((m) => ({ default: m.CopilotPanel })),
);

type LazyMountProps = {
  flowId: string;
  setFlowVersion: (v: FlowVersion) => void;
};

export function CopilotPanelLazyMount({
  flowId,
  setFlowVersion,
}: LazyMountProps) {
  return (
    <React.Suspense
      fallback={
        <div className="p-3 text-xs text-muted-foreground">
          Loading copilot…
        </div>
      }
    >
      <CopilotPanelLazy flowId={flowId} setFlowVersion={setFlowVersion} />
    </React.Suspense>
  );
}

export { CopilotToggleButton } from './copilot-toggle-button';
export { useCopilotStore } from './copilot-store';
