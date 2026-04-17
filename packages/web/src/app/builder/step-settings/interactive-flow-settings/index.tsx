import { InteractiveFlowAction } from '@activepieces/shared';
import React from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

type InteractiveFlowSettingsProps = {
  readonly: boolean;
};

export const InteractiveFlowSettings = React.memo(
  ({ readonly }: InteractiveFlowSettingsProps) => {
    const form = useFormContext<InteractiveFlowAction>();
    const { t } = useTranslation();

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
                onChange={field.onChange}
                value={field.value ?? ''}
                placeholder={t('Welcome message for the interactive flow')}
              />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="settings.mcpServerUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('MCP Server URL')}</FormLabel>
              <Input
                disabled={readonly}
                onChange={field.onChange}
                value={field.value ?? ''}
                placeholder={t('https://mcp-gateway:7860/mcp')}
              />
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
