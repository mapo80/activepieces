import { InteractiveFlowAction } from '@activepieces/shared';
import React from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

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
import { Textarea } from '@/components/ui/textarea';
import { mcpGatewaysQueries } from '@/features/mcp-gateways/lib/mcp-gateways-hooks';

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
          <TabsList>
            <TabsTrigger value="general">{t('General')}</TabsTrigger>
            <TabsTrigger value="gateway">{t('Gateway & AI')}</TabsTrigger>
            <TabsTrigger value="prompt">{t('System prompt')}</TabsTrigger>
            <TabsTrigger value="style">{t('Conversation style')}</TabsTrigger>
            <TabsTrigger value="fields">{t('State fields')}</TabsTrigger>
            <TabsTrigger value="nodes">{t('Nodes')}</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <div className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="settings.greeting"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Greeting Message (EN)')}</FormLabel>
                    <Input
                      disabled={readonly}
                      onChange={(e) => field.onChange({ en: e.target.value })}
                      value={
                        typeof field.value === 'string'
                          ? field.value
                          : field.value?.en ?? ''
                      }
                      placeholder={t(
                        'Welcome message for the interactive flow',
                      )}
                    />
                  </FormItem>
                )}
              />
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
                    <FormLabel>
                      {t('Initial message expression')}{' '}
                      <span className="text-muted-foreground">
                        (e.g. {'{{trigger.body.message}}'})
                      </span>
                    </FormLabel>
                    <Input
                      disabled={readonly}
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

          <TabsContent value="prompt">
            <FormField
              control={form.control}
              name="settings.systemPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('System prompt')}</FormLabel>
                  <Textarea
                    disabled={readonly}
                    rows={12}
                    placeholder={t(
                      'You are a banking assistant helping the user close an account…',
                    )}
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(e.target.value || undefined)
                    }
                  />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="style">
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

          <TabsContent value="fields">
            <StateFieldsEditor readonly={readonly} />
          </TabsContent>

          <TabsContent value="nodes">
            <NodesEditor readonly={readonly} />
          </TabsContent>
        </Tabs>

        <div className="text-sm text-muted-foreground">
          {t('Interactive flow nodes: {{count}}', {
            count: form.watch('settings.nodes')?.length ?? 0,
          })}
        </div>
      </div>
    );
  },
);

InteractiveFlowSettings.displayName = 'InteractiveFlowSettings';
