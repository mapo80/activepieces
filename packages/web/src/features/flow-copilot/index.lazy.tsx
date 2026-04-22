import React from 'react';

const CopilotPanelLazy = React.lazy(() =>
  import('./copilot-panel').then((m) => ({ default: m.CopilotPanel })),
);

export function CopilotPanelLazyMount() {
  return (
    <React.Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading copilot…</div>}>
      <CopilotPanelLazy />
    </React.Suspense>
  );
}

export { CopilotToggleButton } from './copilot-toggle-button';
export { useCopilotStore } from './copilot-store';
