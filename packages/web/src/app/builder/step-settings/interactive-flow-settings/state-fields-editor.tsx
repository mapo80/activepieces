import { InteractiveFlowAction } from '@activepieces/shared';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import React, { useId, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'date',
] as const;

const PARSERS = [
  'ndg',
  'rapportoId',
  'absolute-date',
  'reason-code-cued',
  'confirmation-keyword',
  'ner-name',
] as const;

const EXTRACTION_SCOPES = ['global', 'node-local'] as const;

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
          <StateFieldRow
            key={field.id}
            index={index}
            readonly={readonly}
            onRemove={() => remove(index)}
          />
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

function StateFieldRow({
  index,
  readonly,
  onRemove,
}: {
  index: number;
  readonly: boolean;
  onRemove: () => void;
}): React.ReactElement {
  const form = useFormContext<InteractiveFlowAction>();
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const datalistId = useId();

  const allFields = useWatch({
    control: form.control,
    name: 'settings.stateFields',
  });
  const arrayFieldNames = (allFields ?? [])
    .filter(
      (f) =>
        f?.type === 'array' && typeof f.name === 'string' && f.name.length > 0,
    )
    .map((f) => f.name as string);

  return (
    <div
      className="rounded border border-border p-2"
      data-testid={`state-field-row-${index}`}
    >
      <div className="grid grid-cols-[1fr_120px_1fr_auto_auto_auto] items-center gap-2">
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
          onClick={onRemove}
          aria-label={t('Remove state field')}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="mt-2"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
            data-testid={`state-field-row-${index}-advanced-toggle`}
          >
            {advancedOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {t('Advanced')}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div
            className={cn(
              'grid grid-cols-2 gap-2 rounded bg-muted/30 p-2 text-xs',
            )}
            data-testid={`state-field-row-${index}-advanced-panel`}
          >
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.label.it`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Label (IT)')}
                  <Input
                    disabled={readonly}
                    placeholder={t('Etichetta visibile')}
                    className="text-xs"
                    value={inner.value ?? ''}
                    onChange={inner.onChange}
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.label.en`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Label (EN)')}
                  <Input
                    disabled={readonly}
                    placeholder={t('Display label')}
                    className="text-xs"
                    value={inner.value ?? ''}
                    onChange={inner.onChange}
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.parser`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Parser')}
                  <Select
                    disabled={readonly}
                    value={inner.value ?? '__none__'}
                    onValueChange={(v) =>
                      inner.onChange(v === '__none__' ? undefined : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('None')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('None')}</SelectItem>
                      {PARSERS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.format`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Format')}
                  <Input
                    disabled={readonly}
                    placeholder="date / email / ..."
                    className="font-mono text-xs"
                    value={inner.value ?? ''}
                    onChange={(e) =>
                      inner.onChange(e.target.value || undefined)
                    }
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.pattern`}
              render={({ field: inner }) => (
                <label className="col-span-2 flex flex-col gap-1">
                  {t('Pattern (regex)')}
                  <Input
                    disabled={readonly}
                    placeholder="^\\d{6,10}$"
                    className="font-mono text-xs"
                    value={inner.value ?? ''}
                    onChange={(e) =>
                      inner.onChange(e.target.value || undefined)
                    }
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.minLength`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Min length')}
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    disabled={readonly}
                    className="text-xs"
                    value={inner.value ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      inner.onChange(v === '' ? undefined : Number(v));
                    }}
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.maxLength`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Max length')}
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    disabled={readonly}
                    className="text-xs"
                    value={inner.value ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      inner.onChange(v === '' ? undefined : Number(v));
                    }}
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.enumFrom`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Enum from (state array)')}
                  <Input
                    disabled={readonly}
                    list={datalistId}
                    placeholder={t('another stateField of type=array')}
                    className="font-mono text-xs"
                    value={inner.value ?? ''}
                    onChange={(e) =>
                      inner.onChange(e.target.value || undefined)
                    }
                  />
                  <datalist id={datalistId}>
                    {arrayFieldNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.enumValueField`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Enum value field (key in enum array items)')}
                  <Input
                    disabled={readonly}
                    placeholder="code / id"
                    className="font-mono text-xs"
                    value={inner.value ?? ''}
                    onChange={(e) =>
                      inner.onChange(e.target.value || undefined)
                    }
                  />
                </label>
              )}
            />
            <FormField
              control={form.control}
              name={`settings.stateFields.${index}.extractionScope`}
              render={({ field: inner }) => (
                <label className="flex flex-col gap-1">
                  {t('Extraction scope')}
                  <Select
                    disabled={readonly}
                    value={inner.value ?? 'global'}
                    onValueChange={(v) =>
                      inner.onChange(v === 'global' ? undefined : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXTRACTION_SCOPES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
            />
            <label className="flex items-end gap-2">
              <FormField
                control={form.control}
                name={`settings.stateFields.${index}.internal`}
                render={({ field: inner }) => (
                  <Checkbox
                    disabled={readonly}
                    checked={inner.value === true}
                    onCheckedChange={(c) => inner.onChange(Boolean(c))}
                  />
                )}
              />
              {t('Internal (hidden from bot context)')}
            </label>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
