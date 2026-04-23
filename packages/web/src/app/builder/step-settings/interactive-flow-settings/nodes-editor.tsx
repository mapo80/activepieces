import {
  InteractiveFlowAction,
  InteractiveFlowNodeType,
} from '@activepieces/shared';
import {
  CircleCheck,
  GitBranch,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react';
import React, { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { McpToolPickerDialog } from '@/features/interactive-flow/components/mcp-tool-picker-dialog';
import { interactiveFlowComponentRegistry } from '@/features/interactive-flow/components/registry';
import { cn } from '@/lib/utils';

const NODE_TYPE_META: Record<
  InteractiveFlowNodeType,
  { icon: React.ElementType; borderClass: string; iconClass: string }
> = {
  [InteractiveFlowNodeType.TOOL]: {
    icon: Wrench,
    borderClass: 'border-l-2 border-l-blue-500',
    iconClass: 'text-blue-500',
  },
  [InteractiveFlowNodeType.USER_INPUT]: {
    icon: MessageSquare,
    borderClass: 'border-l-2 border-l-emerald-500',
    iconClass: 'text-emerald-500',
  },
  [InteractiveFlowNodeType.CONFIRM]: {
    icon: CircleCheck,
    borderClass: 'border-l-2 border-l-amber-500',
    iconClass: 'text-amber-500',
  },
  [InteractiveFlowNodeType.BRANCH]: {
    icon: GitBranch,
    borderClass: 'border-l-2 border-l-purple-500',
    iconClass: 'text-purple-500',
  },
};

const NODE_TYPE_VALUES = [
  InteractiveFlowNodeType.TOOL,
  InteractiveFlowNodeType.USER_INPUT,
  InteractiveFlowNodeType.CONFIRM,
  InteractiveFlowNodeType.BRANCH,
];

type Props = { readonly: boolean };

export function NodesEditor({ readonly }: Props): React.ReactElement {
  const form = useFormContext<InteractiveFlowAction>();
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'settings.nodes',
  });
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [groupByType, setGroupByType] = useState<boolean>(true);
  const activeNode = form.watch(`settings.nodes.${activeIndex}`);
  const mcpGatewayId = form.watch('settings.mcpGatewayId');
  const stateFieldNames = (form.watch('settings.stateFields') ?? [])
    .map((f) => f.name)
    .filter((n): n is string => !!n);

  type GroupedEntry = { header: string; arrayIndices: number[] };
  const groupedList: GroupedEntry[] = groupByType
    ? NODE_TYPE_VALUES.flatMap((nt) => {
        const arrayIndices = fields
          .map((_, idx) => idx)
          .filter(
            (idx) => form.getValues(`settings.nodes.${idx}.nodeType`) === nt,
          );
        if (arrayIndices.length === 0) return [];
        return [{ header: `${nt} (${arrayIndices.length})`, arrayIndices }];
      })
    : [{ header: '', arrayIndices: fields.map((_, idx) => idx) }];

  return (
    <div className="grid grid-cols-[180px_1fr] gap-3">
      <div
        className="flex flex-col gap-2"
        data-testid="interactive-flow-nodes-list"
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <Label
            htmlFor="nodes-group-by-type"
            className="cursor-pointer text-[11px] text-muted-foreground"
          >
            {t('Group by type')}
          </Label>
          <Switch
            id="nodes-group-by-type"
            checked={groupByType}
            onCheckedChange={setGroupByType}
            data-testid="nodes-group-by-type-toggle"
          />
        </div>
        {groupedList.map((group) => (
          <div
            key={group.header || 'flat'}
            className="flex flex-col gap-1"
            data-testid={
              group.header
                ? `nodes-group-${group.header.split(' ')[0]}`
                : 'nodes-flat'
            }
          >
            {group.header && (
              <div className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.header}
              </div>
            )}
            {group.arrayIndices.map((idx) => {
              const node = form.watch(`settings.nodes.${idx}`);
              const nodeType = node?.nodeType as
                | InteractiveFlowNodeType
                | undefined;
              const meta = nodeType ? NODE_TYPE_META[nodeType] : undefined;
              const Icon = meta?.icon;
              return (
                <button
                  key={fields[idx].id}
                  type="button"
                  className={cn(
                    'flex items-center justify-between rounded border px-2 py-1.5 text-left text-xs transition-colors',
                    idx === activeIndex
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted',
                    meta?.borderClass,
                  )}
                  onClick={() => setActiveIndex(idx)}
                  data-testid={`node-card-${idx}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {Icon && (
                      <Icon
                        className={cn('size-3.5 shrink-0', meta?.iconClass)}
                      />
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono">
                        {node?.name ?? ''}
                      </span>
                      {!groupByType && (
                        <span className="text-[10px] text-muted-foreground">
                          {node?.nodeType}
                        </span>
                      )}
                    </div>
                  </div>
                  <Trash2
                    className="size-3 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(idx);
                      if (activeIndex >= fields.length - 1) {
                        setActiveIndex(Math.max(0, fields.length - 2));
                      }
                    }}
                  />
                </button>
              );
            })}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readonly}
          onClick={() => {
            append({
              id: `node_${fields.length}`,
              name: `node_${fields.length}`,
              displayName: t('New node'),
              nodeType: InteractiveFlowNodeType.USER_INPUT,
              stateInputs: [],
              stateOutputs: [],
              render: { component: 'TextInput', props: {} },
              message: { en: '' },
            });
            setActiveIndex(fields.length);
          }}
          data-testid="interactive-flow-add-node"
        >
          <Plus className="size-4" /> {t('Add node')}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded border border-border p-3">
        {fields.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('No nodes yet — add your first one.')}
          </div>
        ) : activeNode ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <FormField
                control={form.control}
                name={`settings.nodes.${activeIndex}.name`}
                render={({ field }) => (
                  <label className="flex flex-col gap-1 text-xs">
                    {t('Name')}
                    <Input disabled={readonly} {...field} />
                  </label>
                )}
              />
              <FormField
                control={form.control}
                name={`settings.nodes.${activeIndex}.displayName`}
                render={({ field }) => (
                  <label className="flex flex-col gap-1 text-xs">
                    {t('Display name')}
                    <Input disabled={readonly} {...field} />
                  </label>
                )}
              />
              <FormField
                control={form.control}
                name={`settings.nodes.${activeIndex}.nodeType`}
                render={({ field }) => (
                  <label className="flex flex-col gap-1 text-xs">
                    {t('Node type')}
                    <Select
                      disabled={readonly}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NODE_TYPE_VALUES.map((nt) => (
                          <SelectItem key={nt} value={nt}>
                            {nt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
              />
              {activeNode.nodeType === InteractiveFlowNodeType.TOOL && (
                <FormField
                  control={form.control}
                  name={`settings.nodes.${activeIndex}.tool`}
                  render={({ field }) => (
                    <label className="flex flex-col gap-1 text-xs">
                      {t('MCP Tool')}
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          disabled={readonly}
                          className="font-mono"
                          placeholder={
                            mcpGatewayId
                              ? t('Select a tool…')
                              : t('Select a gateway first')
                          }
                          value={field.value ?? ''}
                          data-testid={`node-tool-value-${activeIndex}`}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={readonly || !mcpGatewayId}
                          onClick={() => setToolPickerOpen(true)}
                          aria-label={t('Browse MCP tools')}
                          title={t('Browse MCP tools')}
                          data-testid={`node-tool-browse-${activeIndex}`}
                        >
                          <Search className="size-4" />
                        </Button>
                      </div>
                    </label>
                  )}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <FieldMultiSelect
                label={t('Reads (state inputs)')}
                path={`settings.nodes.${activeIndex}.stateInputs`}
                options={stateFieldNames}
                disabled={readonly}
              />
              <FieldMultiSelect
                label={t('Writes (state outputs)')}
                path={`settings.nodes.${activeIndex}.stateOutputs`}
                options={stateFieldNames}
                disabled={readonly}
              />
            </div>

            {(activeNode.nodeType === InteractiveFlowNodeType.USER_INPUT ||
              activeNode.nodeType === InteractiveFlowNodeType.CONFIRM) && (
              <div className="flex flex-col gap-2">
                <FormField
                  control={form.control}
                  name={`settings.nodes.${activeIndex}.render.component`}
                  render={({ field }) => (
                    <label className="flex flex-col gap-1 text-xs">
                      {t('Render component')}
                      <Select
                        disabled={readonly}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {interactiveFlowComponentRegistry
                            .listComponentNames()
                            .map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                />
                <MessageEditor
                  path={`settings.nodes.${activeIndex}.message`}
                  readonly={readonly}
                />
                {activeNode.nodeType === InteractiveFlowNodeType.USER_INPUT && (
                  <FormField
                    control={form.control}
                    name={`settings.nodes.${activeIndex}.singleOptionStrategy`}
                    render={({ field }) => (
                      <label className="flex flex-col gap-1 text-xs">
                        {t('When the list has a single option')}
                        <Select
                          disabled={readonly}
                          value={field.value ?? 'confirm'}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger data-testid="single-option-strategy">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="confirm">
                              {t('Ask confirmation (Yes/No)')}
                            </SelectItem>
                            <SelectItem value="auto">
                              {t('Auto-select without asking')}
                            </SelectItem>
                            <SelectItem value="list">
                              {t('Show the list anyway')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    )}
                  />
                )}
                <LivePreview
                  componentName={activeNode.render?.component}
                  propsJson={
                    activeNode.render?.props as
                      | Record<string, unknown>
                      | undefined
                  }
                />
              </div>
            )}

            {activeNode.nodeType === InteractiveFlowNodeType.BRANCH && (
              <div className="text-xs text-muted-foreground">
                {t(
                  'Branch editor uses the ROUTER conditions UI (wire-up in follow-up).',
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
      {activeNode?.nodeType === InteractiveFlowNodeType.TOOL && (
        <McpToolPickerDialog
          gatewayId={mcpGatewayId ?? null}
          open={toolPickerOpen}
          onOpenChange={setToolPickerOpen}
          currentValue={activeNode.tool}
          onSelect={(toolName, inputSchema) => {
            form.setValue(`settings.nodes.${activeIndex}.tool`, toolName, {
              shouldDirty: true,
            });
            if (mcpGatewayId && inputSchema !== undefined) {
              form.setValue(
                `settings.nodes.${activeIndex}.toolInputSchemaSnapshot`,
                {
                  capturedAt: new Date().toISOString(),
                  gatewayId: mcpGatewayId,
                  schema: inputSchema,
                },
                { shouldDirty: true },
              );
            }
          }}
        />
      )}
    </div>
  );
}

function FieldMultiSelect({
  label,
  path,
  options,
  disabled,
}: {
  label: string;
  path:
    | `settings.nodes.${number}.stateInputs`
    | `settings.nodes.${number}.stateOutputs`;
  options: string[];
  disabled: boolean;
}): React.ReactElement {
  const form = useFormContext<InteractiveFlowAction>();
  const value = (form.watch(path) as string[] | undefined) ?? [];
  const toggle = (name: string): void => {
    const next = value.includes(name)
      ? value.filter((v) => v !== name)
      : [...value, name];
    form.setValue(path, next, { shouldDirty: true });
  };
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span>{label}</span>
      <div className="flex flex-wrap gap-1 rounded border border-border p-1">
        {options.length === 0 ? (
          <span className="text-[10px] text-muted-foreground">
            (define state fields first)
          </span>
        ) : (
          options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                value.includes(opt)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground',
              )}
            >
              {opt}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function MessageEditor({
  path,
  readonly,
}: {
  path: `settings.nodes.${number}.message`;
  readonly: boolean;
}): React.ReactElement {
  const form = useFormContext<InteractiveFlowAction>();
  const raw = form.watch(path);
  const isDynamic = typeof raw === 'object' && raw !== null && 'dynamic' in raw;

  const toggleDynamic = (): void => {
    if (isDynamic) {
      form.setValue(path, { en: '' }, { shouldDirty: true });
    } else {
      form.setValue(
        path,
        { dynamic: true, fallback: { en: '' } },
        { shouldDirty: true },
      );
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-dashed border-border p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          {isDynamic ? 'Dynamic (LLM-generated)' : 'Static message'}
        </span>
        <button
          type="button"
          className="text-[10px] underline"
          disabled={readonly}
          onClick={toggleDynamic}
        >
          Toggle
        </button>
      </div>
      {isDynamic ? (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">
            Fallback (en)
          </label>
          <Textarea
            disabled={readonly}
            rows={2}
            value={(raw as { fallback?: { en?: string } }).fallback?.en ?? ''}
            onChange={(e) =>
              form.setValue(
                path,
                {
                  dynamic: true,
                  fallback: { en: e.target.value },
                },
                { shouldDirty: true },
              )
            }
          />
          <label className="text-[10px] text-muted-foreground">
            Extra guidance (systemPromptAddendum)
          </label>
          <Textarea
            disabled={readonly}
            rows={2}
            value={
              (raw as { systemPromptAddendum?: string }).systemPromptAddendum ??
              ''
            }
            onChange={(e) =>
              form.setValue(
                path,
                {
                  ...(raw as object),
                  systemPromptAddendum: e.target.value,
                },
                { shouldDirty: true },
              )
            }
          />
        </div>
      ) : (
        <Textarea
          disabled={readonly}
          rows={2}
          value={
            typeof raw === 'string'
              ? raw
              : (raw as Record<string, string> | undefined)?.en ?? ''
          }
          onChange={(e) =>
            form.setValue(path, { en: e.target.value }, { shouldDirty: true })
          }
        />
      )}
    </div>
  );
}

function LivePreview({
  componentName,
  propsJson,
}: {
  componentName: string | undefined;
  propsJson: Record<string, unknown> | undefined;
}): React.ReactElement | null {
  if (!componentName) return null;
  const entry = interactiveFlowComponentRegistry.getEntry(componentName);
  if (!entry) {
    return (
      <div className="rounded border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive">
        Unknown component: {componentName}
      </div>
    );
  }
  const sample = entry.sampleState({});
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Live preview
      </div>
      {entry.preview({ ...(propsJson ?? {}), ...sample })}
    </div>
  );
}
