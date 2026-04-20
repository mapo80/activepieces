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
import { mcpGatewaysQueries } from '@/features/mcp-gateways/lib/mcp-gateways-hooks';

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
      <div className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="settings.greeting"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Greeting Message')}</FormLabel>
              <Input
                disabled={readonly}
                onChange={(e) => field.onChange({ en: e.target.value })}
                value={
                  typeof field.value === 'string'
                    ? field.value
                    : field.value?.en ?? ''
                }
                placeholder={t('Welcome message for the interactive flow')}
              />
            </FormItem>
          )}
        />
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
                  <Link to="/platform/setup/mcp-gateways" className="underline">
                    {t('Create one')}
                  </Link>
                </div>
              )}
            </FormItem>
          )}
        />
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
