import { InteractiveFlowAction } from '@activepieces/shared';
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  MessageSquareText,
  Palette,
  Settings as SettingsIcon,
  Sparkles,
  Workflow,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { MarkdownEditor } from '@/components/custom/markdown-editor';
import { FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { mcpGatewaysQueries } from '@/features/mcp-gateways/lib/mcp-gateways-hooks';
import { cn } from '@/lib/utils';

import { NodesEditor } from './nodes-editor';
import { StateFieldsEditor } from './state-fields-editor';

const AI_PROVIDERS = ['openai', 'anthropic', 'azure', 'custom'];
const STYLE_TEMPLATES = [
  'banking_formal_it',
  'banking_formal_en',
  'customer_support_it',
  'customer_support_en',
  'kyc_strict',
  'casual_it',
  'casual_en',
];

type InteractiveFlowSettingsProps = {
  readonly: boolean;
};

export const InteractiveFlowSettings = React.memo(
  ({ readonly }: InteractiveFlowSettingsProps) => {
    const form = useFormContext<InteractiveFlowAction>();
    const { t } = useTranslation();
    const { data: gateways, isLoading } = mcpGatewaysQueries.useList();
    const hasGateways = !isLoading && (gateways?.length ?? 0) > 0;

    return (
      <div
        className="flex flex-col gap-4"
        data-testid="interactive-flow-settings"
      >
        <Tabs defaultValue="general">
          <ScrollableTabsList>
            <TabsTrigger value="general" className="gap-1.5">
              <SettingsIcon className="size-3.5" />
              {t('General')}
            </TabsTrigger>
            <TabsTrigger value="gateway" className="gap-1.5">
              <Sparkles className="size-3.5" />
              {t('Gateway & AI')}
            </TabsTrigger>
            <TabsTrigger value="style" className="gap-1.5">
              <Palette className="size-3.5" />
              {t('Conversation style')}
            </TabsTrigger>
            <TabsTrigger value="prompt" className="gap-1.5">
              <MessageSquareText className="size-3.5" />
              {t('System prompt')}
            </TabsTrigger>
            <TabsTrigger value="fields" className="gap-1.5">
              <Database className="size-3.5" />
              {t('State fields')}
            </TabsTrigger>
            <TabsTrigger value="nodes" className="gap-1.5">
              <Workflow className="size-3.5" />
              {t('Nodes')}
            </TabsTrigger>
          </ScrollableTabsList>

          <TabsContent value="general">
            <p className="pb-3 text-xs text-muted-foreground">
              {t(
                'Greeting shown when the conversation starts, default locale of generated messages, and the expression used to seed the extractor on the very first turn.',
              )}
            </p>
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="settings.locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Default locale')}</FormLabel>
                    <Input
                      disabled={readonly}
                      placeholder="en"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || undefined)
                      }
                    />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="settings.messageInput"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      {t('Initial message expression')}
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none"
                              aria-label={t('What is this?')}
                            >
                              <CircleHelp className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            align="start"
                            className="max-w-sm text-xs leading-relaxed"
                          >
                            {t(
                              'AP template expression read when the flow starts — use `{{trigger.body.message}}` to feed the field-extractor with the first free-text message from the webhook payload.',
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </FormLabel>
                    <Input
                      disabled={readonly}
                      placeholder="{{trigger.body.message}}"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || undefined)
                      }
                    />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          <TabsContent value="gateway">
            <p className="pb-3 text-xs text-muted-foreground">
              {t(
                'Which MCP Gateway powers the tool calls, and which AI provider/model the field-extractor uses to read free-text user messages into stateFields.',
              )}
            </p>
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="settings.mcpGatewayId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('MCP Gateway')}</FormLabel>
                    <Select
                      disabled={readonly || !hasGateways}
                      value={field.value ?? ''}
                      onValueChange={(value) =>
                        field.onChange(value === '' ? undefined : value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            isLoading
                              ? t('Loading…')
                              : hasGateways
                              ? t('Select an MCP gateway')
                              : t('No MCP gateways configured yet.')
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {gateways?.map((gateway) => (
                          <SelectItem key={gateway.id} value={gateway.id}>
                            {gateway.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isLoading && !hasGateways && (
                      <div className="text-xs text-muted-foreground">
                        {t('No MCP gateways configured yet.')}{' '}
                        <Link
                          to="/platform/setup/mcp-gateways"
                          className="underline"
                        >
                          {t('Create one')}
                        </Link>
                      </div>
                    )}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="settings.fieldExtractor.aiProviderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Field extractor: provider')}</FormLabel>
                    <Select
                      disabled={readonly}
                      value={field.value ?? ''}
                      onValueChange={(v) =>
                        field.onChange(v === '' ? undefined : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('Choose a provider')} />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_PROVIDERS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="settings.fieldExtractor.model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Field extractor: model')}</FormLabel>
                    <Input
                      disabled={readonly}
                      placeholder="gpt-4o-mini"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || undefined)
                      }
                    />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          <TabsContent value="style">
            <p className="pb-3 text-xs text-muted-foreground">
              {t(
                'Configures the LLM that generates pause-time questions for nodes whose message is set to `dynamic`. Pick the provider/model and one of the built-in style templates (e.g. banking_formal_it) to match your domain tone.',
              )}
            </p>
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="settings.questionGenerator.aiProviderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Question generator: provider')}</FormLabel>
                    <Select
                      disabled={readonly}
                      value={field.value ?? ''}
                      onValueChange={(v) =>
                        field.onChange(v === '' ? undefined : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('Choose a provider')} />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_PROVIDERS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="settings.questionGenerator.model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Question generator: model')}</FormLabel>
                    <Input
                      disabled={readonly}
                      placeholder="gpt-4o"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || undefined)
                      }
                    />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="settings.questionGenerator.styleTemplate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Style template')}</FormLabel>
                    <Select
                      disabled={readonly}
                      value={field.value ?? ''}
                      onValueChange={(v) =>
                        field.onChange(v === '' ? undefined : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('Choose a style')} />
                      </SelectTrigger>
                      <SelectContent>
                        {STYLE_TEMPLATES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          <TabsContent value="prompt">
            <p className="pb-3 text-xs text-muted-foreground">
              {t(
                'Role and guardrails shared by the field-extractor and the question-generator LLMs. Keep it short; the full conversation context is already appended at runtime.',
              )}
            </p>
            <FormField
              control={form.control}
              name="settings.systemPrompt"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-2">
                  <FormLabel>{t('System prompt')}</FormLabel>
                  <MarkdownEditor
                    value={field.value ?? ''}
                    readonly={readonly}
                    placeholder={t(
                      'You are a banking assistant helping the user close an account…',
                    )}
                    className="h-[calc(100vh-320px)] min-h-[360px]"
                    minHeight="100%"
                    onChange={(next) => field.onChange(next || undefined)}
                  />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="fields">
            <p className="pb-3 text-xs text-muted-foreground">
              {t(
                'The conversation memory. Each row is one field the flow reads/writes. `extract` lets the field-extractor LLM fill it from free-text; `sensitive` redacts it from pause metadata and LLM prompts.',
              )}
            </p>
            <StateFieldsEditor readonly={readonly} />
          </TabsContent>

          <TabsContent value="nodes">
            <p className="pb-3 text-xs text-muted-foreground">
              {t(
                'The sequence of TOOL / USER_INPUT / CONFIRM / BRANCH nodes. The `reads` / `writes` of each node on stateFields determine the execution order (no manual wiring needed).',
              )}
            </p>
            <NodesEditor readonly={readonly} />
          </TabsContent>
        </Tabs>

        <div className="text-sm text-muted-foreground">
          {t('Interactive flow nodes')}:{' '}
          {form.watch('settings.nodes')?.length ?? 0}
        </div>
      </div>
    );
  },
);

InteractiveFlowSettings.displayName = 'InteractiveFlowSettings';

function ScrollableTabsList({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback((): void => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    const resizeObserver = new ResizeObserver(updateArrows);
    resizeObserver.observe(el);
    el.addEventListener('scroll', updateArrows, { passive: true });
    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('scroll', updateArrows);
    };
  }, [updateArrows]);

  const scrollBy = (delta: number): void => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="interactive-flow-tabs-scroller"
      >
        <TabsList className="flex-nowrap">{children}</TabsList>
      </div>
      {canScrollLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-120)}
          className={cn(
            'absolute left-0 top-1/2 z-10 flex h-7 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-background shadow-sm',
            'hover:bg-muted focus:outline-none',
          )}
          data-testid="interactive-flow-tabs-scroll-left"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(120)}
          className={cn(
            'absolute right-0 top-1/2 z-10 flex h-7 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-background shadow-sm',
            'hover:bg-muted focus:outline-none',
          )}
          data-testid="interactive-flow-tabs-scroll-right"
        >
          <ChevronRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}
