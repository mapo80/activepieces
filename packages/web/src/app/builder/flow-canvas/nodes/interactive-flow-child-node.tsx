import {
  InteractiveFlowBranchNode,
  InteractiveFlowConfirmNode,
  InteractiveFlowNode,
  InteractiveFlowNodeType,
  InteractiveFlowToolNode,
  InteractiveFlowUserInputNode,
  isNil,
} from '@activepieces/shared';
import { Handle, NodeProps, Position } from '@xyflow/react';
import { t } from 'i18next';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Circle,
  GitBranch,
  MessageSquare,
  PauseCircle,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import React from 'react';

import { useBuilderStateContext } from '@/app/builder/builder-hooks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { InteractiveFlowNodeStatus } from '@/features/interactive-flow/hooks/interactive-flow-runtime-reducer';
import { useInteractiveFlowNodeStates } from '@/features/interactive-flow/hooks/use-interactive-flow-node-states';
import { cn } from '@/lib/utils';

import { flowCanvasConsts } from '../utils/consts';
import { phaseColors } from '../utils/phase-colors';
import { ApInteractiveFlowChildNode } from '../utils/types';

type ChildNodeProps = NodeProps & { data: ApInteractiveFlowChildNode['data'] };

function nodeTypeIcon(nodeType: InteractiveFlowNodeType): React.ReactElement {
  switch (nodeType) {
    case InteractiveFlowNodeType.TOOL:
      return <Wrench className="size-3.5" aria-label="Tool node" />;
    case InteractiveFlowNodeType.USER_INPUT:
      return (
        <MessageSquare className="size-3.5" aria-label="User input node" />
      );
    case InteractiveFlowNodeType.CONFIRM:
      return <CheckCircle2 className="size-3.5" aria-label="Confirm node" />;
    case InteractiveFlowNodeType.BRANCH:
      return <GitBranch className="size-3.5" aria-label="Branch node" />;
  }
}

function statusIcon(
  status: InteractiveFlowNodeStatus | undefined,
): React.ReactElement | null {
  switch (status) {
    case 'STARTED':
      return <Circle className="size-3 animate-pulse text-blue-500" />;
    case 'COMPLETED':
      return <CheckCircle2 className="size-3 text-green-500" />;
    case 'FAILED':
      return <XCircle className="size-3 text-red-500" />;
    case 'SKIPPED':
      return <ArrowRightLeft className="size-3 text-gray-400" />;
    case 'PAUSED':
      return <PauseCircle className="size-3 animate-pulse text-yellow-500" />;
    default:
      return null;
  }
}

function TypeBadge({
  node,
}: {
  node: InteractiveFlowNode;
}): React.ReactElement | null {
  if (node.nodeType === InteractiveFlowNodeType.TOOL) {
    const tool = (node as InteractiveFlowToolNode).tool;
    const short = tool.split('/').pop() ?? tool;
    return (
      <span className="truncate rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-900 dark:text-blue-200">
        {short}
      </span>
    );
  }
  if (
    node.nodeType === InteractiveFlowNodeType.USER_INPUT ||
    node.nodeType === InteractiveFlowNodeType.CONFIRM
  ) {
    const component = (
      node as InteractiveFlowUserInputNode | InteractiveFlowConfirmNode
    ).render?.component;
    return (
      <span className="truncate rounded bg-purple-100 px-1.5 py-0.5 font-mono text-[10px] text-purple-700 dark:bg-purple-900 dark:text-purple-200">
        {component}
      </span>
    );
  }
  if (node.nodeType === InteractiveFlowNodeType.BRANCH) {
    const branchCount = (node as InteractiveFlowBranchNode).branches.length;
    return (
      <span className="truncate rounded bg-orange-100 px-1.5 py-0.5 font-mono text-[10px] text-orange-700 dark:bg-orange-900 dark:text-orange-200">
        {branchCount} {t('branches')}
      </span>
    );
  }
  return null;
}

function FieldPillList({
  label,
  fields,
}: {
  label: string;
  fields: string[];
}): React.ReactElement | null {
  if (fields.length === 0) return null;
  return (
    <div className="flex items-start gap-1 text-[10px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wider">{label}:</span>
      <div className="flex flex-wrap gap-1">
        {fields.map((f) => (
          <span key={f} className="rounded bg-muted px-1 py-0.5 font-mono">
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ApInteractiveFlowChildCanvasNode(
  props: ChildNodeProps,
): React.ReactElement {
  const { node, hasDrift, isExtractorTarget, phaseId, phases } = props.data;
  const run = useBuilderStateContext((state) => state.run);
  const runtime = useInteractiveFlowNodeStates(run?.id);
  const status = runtime.nodeStatuses[node.id];
  const colors = phaseColors.get({ phaseId, phases });
  const phaseIndex = phaseColors.getIndex({ phaseId, phases });
  const phaseLabel = phaseColors.getLabel({ phaseId, phases });
  const hasPhase = phaseIndex >= 0;
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={flowCanvasConsts.HANDLE_STYLING}
      />
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <div
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
            className={cn(
              'pointer-events-auto relative flex h-full flex-col overflow-hidden rounded-md border-2 bg-card shadow-sm transition-colors',
              status === 'FAILED' && 'border-red-500',
              status === 'PAUSED' && 'border-yellow-500',
              status === 'COMPLETED' && 'border-green-500',
              status === 'SKIPPED' && 'border-gray-300 opacity-60',
              !status && hasDrift && 'border-amber-500',
              !status && !hasDrift && hasPhase && colors.border,
              !status && !hasDrift && !hasPhase && 'border-border',
            )}
            style={{
              width: flowCanvasConsts.AP_NODE_SIZE.INTERACTIVE_FLOW_CHILD.width,
              height:
                flowCanvasConsts.AP_NODE_SIZE.INTERACTIVE_FLOW_CHILD.height,
            }}
            data-node-id={node.id}
            data-node-type={node.nodeType}
            data-phase-id={phaseId ?? ''}
          >
            {hasPhase && (
              <div
                className={cn('h-1 w-full rounded-t-sm', colors.ribbon)}
                data-testid="phase-ribbon"
              />
            )}

            <div className="flex flex-1 items-center gap-2 px-2 py-1">
              <span className="shrink-0">{nodeTypeIcon(node.nodeType)}</span>
              <span
                className="flex-1 truncate text-xs font-semibold"
                data-testid="iflow-node-title"
              >
                {node.displayName}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <TypeBadge node={node} />
                {hasPhase && phaseLabel && (
                  <span
                    className={cn(
                      'truncate rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                      colors.chip,
                    )}
                    data-testid="phase-chip"
                  >
                    {phaseLabel}
                  </span>
                )}
                {isExtractorTarget && (
                  <Zap
                    className="size-3 text-amber-500"
                    aria-label="Extractor target"
                  />
                )}
                {hasDrift && (
                  <AlertTriangle
                    className="size-3 text-amber-500"
                    aria-label="Schema drift"
                  />
                )}
                {statusIcon(status)}
              </div>
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="center"
          className="w-auto max-w-xs p-3 text-xs"
          data-testid="iflow-node-hover-card"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={() => setPopoverOpen(true)}
          onMouseLeave={() => setPopoverOpen(false)}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="shrink-0">{nodeTypeIcon(node.nodeType)}</span>
            <span
              className="flex-1 font-semibold"
              data-testid="iflow-node-hover-card-title"
            >
              {node.displayName}
            </span>
          </div>
          {hasPhase && phaseLabel && (
            <div
              className={cn(
                'mb-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                colors.chip,
              )}
            >
              {phaseLabel}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <FieldPillList label={t('READS')} fields={node.stateInputs} />
            <FieldPillList label={t('WRITES')} fields={node.stateOutputs} />
          </div>
        </PopoverContent>
      </Popover>
      <Handle
        type="source"
        position={Position.Bottom}
        style={flowCanvasConsts.HANDLE_STYLING}
      />
    </>
  );
}

ApInteractiveFlowChildCanvasNode.displayName =
  'ApInteractiveFlowChildCanvasNode';

export function interactiveFlowChildNodeUtils(): typeof interactiveFlowChildNodeUtilsObject {
  return interactiveFlowChildNodeUtilsObject;
}

const interactiveFlowChildNodeUtilsObject = {
  isDrifted: (node: InteractiveFlowNode): boolean => {
    if (node.nodeType !== InteractiveFlowNodeType.TOOL) return false;
    return (
      !isNil(node.toolInputSchemaSnapshot) &&
      isNil(node.toolInputSchemaSnapshot.schema)
    );
  },
};

export const INTERACTIVE_FLOW_CHILD_NODE_HEIGHT = 44;
