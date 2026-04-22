import { McpGatewayToolSummary } from '@activepieces/shared';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { mcpGatewaysQueries } from '@/features/mcp-gateways/lib/mcp-gateways-hooks';
import { cn } from '@/lib/utils';

interface Props {
  gatewayId: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentValue: string | undefined;
  onSelect: (toolName: string, inputSchema: unknown | undefined) => void;
}

export const McpToolPickerDialog: React.FC<Props> = ({
  gatewayId,
  open,
  onOpenChange,
  currentValue,
  onSelect,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = mcpGatewaysQueries.useTools(
    gatewayId ?? null,
  );
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(
    currentValue ?? null,
  );
  const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (open) {
      setSelectedName(currentValue ?? null);
      setSearch('');
    }
  }, [open, currentValue]);

  const tools = data?.tools ?? [];
  const groupedTools = useMemo(() => groupByNamespace(tools), [tools]);
  const filteredGroups = useMemo(
    () => filterGroups(groupedTools, search),
    [groupedTools, search],
  );

  const selectedTool = tools.find((t2) => t2.name === selectedName) ?? null;
  const orphanedValue =
    currentValue &&
    tools.length > 0 &&
    !tools.some((t2) => t2.name === currentValue);

  const toggleNamespace = (ns: string): void => {
    const next = new Set(collapsedNamespaces);
    if (next.has(ns)) {
      next.delete(ns);
    } else {
      next.add(ns);
    }
    setCollapsedNamespaces(next);
  };

  const handleConfirm = (): void => {
    if (!selectedTool) return;
    onSelect(selectedTool.name, selectedTool.inputSchema);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('Select MCP Tool')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('Search by name or description…')}
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              data-testid="mcp-tool-picker-search"
            />
          </div>

          {orphanedValue && (
            <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                {t(
                  'Current tool "{{tool}}" is not available on this gateway.',
                  { tool: currentValue ?? '' },
                )}
              </span>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center gap-2 rounded border border-border p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('Loading tools…')}
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-start gap-2 rounded border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <div className="text-destructive">
                {t('Failed to load tools.')}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void refetch();
                }}
              >
                {t('Retry')}
              </Button>
            </div>
          )}

          {!isLoading && !isError && tools.length === 0 && (
            <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t('No tools available on this gateway.')}
            </div>
          )}

          {!isLoading && !isError && tools.length > 0 && (
            <div
              className="grid grid-cols-[280px_1fr] gap-3"
              data-testid="mcp-tool-picker-body"
            >
              <ScrollArea className="h-[420px] rounded border border-border">
                {filteredGroups.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    {t('No tools match "{{q}}"', { q: search })}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 p-2">
                    {filteredGroups.map((group) => {
                      const isCollapsed = collapsedNamespaces.has(
                        group.namespace,
                      );
                      return (
                        <div
                          key={group.namespace}
                          data-testid={`mcp-tool-group-${group.namespace}`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleNamespace(group.namespace)}
                            className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            <span className="flex items-center gap-1">
                              {isCollapsed ? (
                                <ChevronRight className="size-3" />
                              ) : (
                                <ChevronDown className="size-3" />
                              )}
                              <span className="font-mono">
                                {group.namespace}
                              </span>
                              <span className="text-muted-foreground">
                                ({group.tools.length})
                              </span>
                            </span>
                          </button>
                          {!isCollapsed && (
                            <div className="mt-1 flex flex-col gap-0.5 pl-4">
                              {group.tools.map((tool) => {
                                const isSelected = selectedName === tool.name;
                                return (
                                  <button
                                    key={tool.name}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => setSelectedName(tool.name)}
                                    onDoubleClick={() => {
                                      setSelectedName(tool.name);
                                      onSelect(tool.name, tool.inputSchema);
                                      onOpenChange(false);
                                    }}
                                    className={cn(
                                      'rounded px-2 py-1 text-left font-mono text-xs transition-colors',
                                      isSelected
                                        ? 'bg-primary/10 text-foreground'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                    )}
                                    data-testid={`mcp-tool-item-${tool.name}`}
                                  >
                                    {shortName(tool.name)}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>

              <ScrollArea
                className="h-[420px] rounded border border-border p-4"
                data-testid="mcp-tool-picker-detail"
              >
                {selectedTool ? (
                  <ToolDetailPanel tool={selectedTool} />
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                    {t('Select a tool to see details.')}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            disabled={!selectedTool}
            onClick={handleConfirm}
            data-testid="mcp-tool-picker-confirm"
          >
            {t('Select')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ToolDetailPanel: React.FC<{ tool: McpGatewayToolSummary }> = ({
  tool,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-foreground">
          {shortName(tool.name)}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {tool.name}
        </div>
      </div>
      {tool.description ? (
        <p className="text-sm leading-relaxed text-foreground">
          {tool.description}
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground">
          {t('No description provided.')}
        </p>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          {t('Input schema')}
        </div>
        <InputSchemaTable schema={tool.inputSchema} />
      </div>
    </div>
  );
};

const InputSchemaTable: React.FC<{ schema: unknown }> = ({ schema }) => {
  const { t } = useTranslation();
  if (!schema || typeof schema !== 'object') {
    return (
      <div className="text-xs italic text-muted-foreground">
        {t('No schema available.')}
      </div>
    );
  }
  const obj = schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = obj.properties ?? {};
  const required = new Set(obj.required ?? []);
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return (
      <div className="text-xs italic text-muted-foreground">
        {t('No input required.')}
      </div>
    );
  }
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="px-2 py-1 font-medium">{t('Parameter')}</th>
          <th className="px-2 py-1 font-medium">{t('Type')}</th>
          <th className="px-2 py-1 font-medium">{t('Required')}</th>
          <th className="px-2 py-1 font-medium">{t('Description')}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, val]) => {
          const spec = (val ?? {}) as {
            type?: string;
            description?: string;
          };
          return (
            <tr key={key} className="border-b border-border/50">
              <td className="px-2 py-1 font-mono">{key}</td>
              <td className="px-2 py-1">{spec.type ?? 'any'}</td>
              <td className="px-2 py-1">{required.has(key) ? '✓' : ''}</td>
              <td className="px-2 py-1 text-muted-foreground">
                {spec.description ?? ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

type ToolGroup = {
  namespace: string;
  tools: McpGatewayToolSummary[];
};

function groupByNamespace(tools: McpGatewayToolSummary[]): ToolGroup[] {
  const map = new Map<string, McpGatewayToolSummary[]>();
  for (const tool of tools) {
    const [first, ...rest] = tool.name.split('/');
    const namespace = rest.length > 0 ? first : 'misc';
    const list = map.get(namespace);
    if (list) {
      list.push(tool);
    } else {
      map.set(namespace, [tool]);
    }
  }
  return [...map.entries()]
    .map(([namespace, list]) => ({
      namespace,
      tools: [...list].sort((a, b) =>
        shortName(a.name).localeCompare(shortName(b.name)),
      ),
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

function filterGroups(groups: ToolGroup[], search: string): ToolGroup[] {
  const query = search.trim().toLowerCase();
  if (!query) return groups;
  return groups
    .map((g) => ({
      namespace: g.namespace,
      tools: g.tools.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.description ?? '').toLowerCase().includes(query),
      ),
    }))
    .filter((g) => g.tools.length > 0);
}

function shortName(fullName: string): string {
  const parts = fullName.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : fullName;
}
