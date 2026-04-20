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
import { InteractiveFlowNodeStatus } from '@/features/interactive-flow/hooks/interactive-flow-runtime-reducer';
import { useInteractiveFlowNodeStates } from '@/features/interactive-flow/hooks/use-interactive-flow-node-states';
import { cn } from '@/lib/utils';

import { flowCanvasConsts } from '../utils/consts';
import { ApInteractiveFlowChildNode } from '../utils/types';

type ChildNodeProps = NodeProps & { data: ApInteractiveFlowChildNode['data'] };

function nodeTypeIcon(nodeType: InteractiveFlowNodeType): React.ReactElement {
  switch (nodeType) {
    case InteractiveFlowNodeType.TOOL:
      return <Wrench className="size-4" aria-label="Tool node" />;
    case InteractiveFlowNodeType.USER_INPUT:
      return <MessageSquare className="size-4" aria-label="User input node" />;
    case InteractiveFlowNodeType.CONFIRM:
      return <CheckCircle2 className="size-4" aria-label="Confirm node" />;
    case InteractiveFlowNodeType.BRANCH:
      return <GitBranch className="size-4" aria-label="Branch node" />;
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

function FieldPillList({
  label,
  fields,
}: {
  label: string;
  fields: string[];
}): React.ReactElement | null {
  if (fields.length === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
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

function ToolNodeBadges({
  node,
}: {
  node: InteractiveFlowToolNode;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-900 dark:text-blue-200">
        MCP {node.tool}
      </span>
    </div>
  );
}

function UserInputNodeBadges({
  node,
}: {
  node: InteractiveFlowUserInputNode | InteractiveFlowConfirmNode;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="rounded bg-purple-100 px-1.5 py-0.5 font-mono text-purple-700 dark:bg-purple-900 dark:text-purple-200">
        {node.render.component}
      </span>
    </div>
  );
}

function BranchNodeBadges({
  node,
}: {
  node: InteractiveFlowBranchNode;
}): React.ReactElement {
  const previews = node.branches
    .slice(0, 2)
    .map((b) => b.branchName)
    .join(' | ');
  return (
    <div className="text-[10px] text-muted-foreground">
      {previews}
      {node.branches.length > 2 ? ` +${node.branches.length - 2}` : ''}
    </div>
  );
}

export function ApInteractiveFlowChildCanvasNode(
  props: ChildNodeProps,
): React.ReactElement {
  const { node, hasDrift, isExtractorTarget } = props.data;
  const run = useBuilderStateContext((state) => state.run);
  const runtime = useInteractiveFlowNodeStates(run?.id);
  const status = runtime.nodeStatuses[node.id];

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={flowCanvasConsts.HANDLE_STYLING}
      />
      <div
        className={cn(
          'flex h-full w-full flex-col gap-1 rounded-lg border-2 bg-card p-2 shadow-sm transition-colors',
          status === 'FAILED' && 'border-red-500',
          status === 'PAUSED' && 'border-yellow-500',
          status === 'COMPLETED' && 'border-green-500',
          status === 'SKIPPED' && 'border-gray-300 opacity-60',
          !status && hasDrift && 'border-amber-500',
          !status && !hasDrift && 'border-border',
        )}
        data-node-id={node.id}
        data-node-type={node.nodeType}
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0">{nodeTypeIcon(node.nodeType)}</span>
          <span className="truncate text-sm font-semibold">
            {node.displayName}
          </span>
          <div className="ml-auto flex items-center gap-1">
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

        {node.nodeType === InteractiveFlowNodeType.TOOL && (
          <ToolNodeBadges node={node} />
        )}
        {(node.nodeType === InteractiveFlowNodeType.USER_INPUT ||
          node.nodeType === InteractiveFlowNodeType.CONFIRM) && (
          <UserInputNodeBadges node={node} />
        )}
        {node.nodeType === InteractiveFlowNodeType.BRANCH && (
          <BranchNodeBadges node={node} />
        )}

        <FieldPillList label="reads" fields={node.stateInputs} />
        <FieldPillList label="writes" fields={node.stateOutputs} />
      </div>
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
