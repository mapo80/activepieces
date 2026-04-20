import { InteractiveFlowAction } from '@activepieces/shared';
import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'date',
] as const;

type Props = { readonly: boolean };

export function StateFieldsEditor({ readonly }: Props): React.ReactElement {
  const form = useFormContext<InteractiveFlowAction>();
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'settings.stateFields',
  });

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="interactive-flow-state-fields-editor"
    >
      <div className="text-sm text-muted-foreground">
        {t(
          'State fields are the conversation memory. Each row is one field the flow can read and write.',
        )}
      </div>
      <div className="flex flex-col gap-2">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="grid grid-cols-[1fr_120px_1fr_auto_auto_auto] items-center gap-2 rounded border border-border p-2"
          >
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.name`}
              render={({ field: inner }) => (
                <Input
                  disabled={readonly}
                  placeholder={t('name (e.g. ndg)')}
                  className="font-mono text-xs"
                  {...inner}
                />
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.type`}
              render={({ field: inner }) => (
                <Select
                  disabled={readonly}
                  value={inner.value ?? 'string'}
                  onValueChange={inner.onChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t2) => (
                      <SelectItem key={t2} value={t2}>
                        {t2}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.description`}
              render={({ field: inner }) => (
                <Input
                  disabled={readonly}
                  placeholder={t('Description for the extractor LLM')}
                  className="text-xs"
                  value={inner.value ?? ''}
                  onChange={inner.onChange}
                />
              )}
            />
            <label className="flex items-center gap-1 text-xs">
              <FormField
                control={form.control}
                name={`settings.stateFields.${index}.extractable`}
                render={({ field: inner }) => (
                  <Checkbox
                    disabled={readonly}
                    checked={inner.value !== false}
                    onCheckedChange={(c) => inner.onChange(Boolean(c))}
                  />
                )}
              />
              {t('extract')}
            </label>
            <label className="flex items-center gap-1 text-xs">
              <FormField
                control={form.control}
                name={`settings.stateFields.${index}.sensitive`}
                render={({ field: inner }) => (
                  <Checkbox
                    disabled={readonly}
                    checked={inner.value === true}
                    onCheckedChange={(c) => inner.onChange(Boolean(c))}
                  />
                )}
              />
              {t('sensitive')}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={readonly}
              onClick={() => remove(index)}
              aria-label={t('Remove state field')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {fields.length === 0 && (
          <div className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            {t('No state fields defined yet.')}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={readonly}
        onClick={() =>
          append({
            name: '',
            type: 'string',
            description: '',
            extractable: true,
            sensitive: false,
          })
        }
        data-testid="interactive-flow-add-state-field"
      >
        <Plus className="size-4" /> {t('Add state field')}
      </Button>
    </div>
  );
}
