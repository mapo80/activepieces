import { NodeProps } from '@xyflow/react';
import { t } from 'i18next';
import React from 'react';

import { ApInteractiveFlowContainerNode } from '../utils/types';

type ContainerProps = NodeProps & {
  data: ApInteractiveFlowContainerNode['data'];
};

export function ApInteractiveFlowContainerCanvasNode(
  props: ContainerProps,
): React.ReactElement {
  const { width, height, parentDisplayName } = props.data;
  return (
    <div
      className="pointer-events-none relative rounded-lg border-2 border-dashed border-muted-foreground/40 bg-muted/5"
      style={{ width, height }}
      data-testid="interactive-flow-container"
      data-parent-step={props.data.parentStepName}
    >
      <span
        className="absolute left-3 -top-2.5 bg-background px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        data-testid="interactive-flow-container-title"
      >
        {t('Interactive Flow')} · {parentDisplayName}
      </span>
    </div>
  );
}

ApInteractiveFlowContainerCanvasNode.displayName =
  'ApInteractiveFlowContainerCanvasNode';
