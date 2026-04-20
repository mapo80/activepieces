import { z } from 'zod';

import { ClientCardPreview, ClientCardThumbnail } from './previews/client-card';
import {
  ConfirmCardPreview,
  ConfirmCardThumbnail,
} from './previews/confirm-card';
import { DataTablePreview, DataTableThumbnail } from './previews/data-table';
import {
  DatePickerCardPreview,
  DatePickerCardThumbnail,
} from './previews/date-picker-card';
import {
  DocumentCardPreview,
  DocumentCardThumbnail,
} from './previews/document-card';
import { TextInputPreview, TextInputThumbnail } from './previews/text-input';

export type ComponentRegistryEntry = {
  name: string;
  propsSchema: z.ZodType;
  thumbnail: (props?: Record<string, unknown>) => React.ReactElement;
  preview: (props: Record<string, unknown>) => React.ReactElement;
  sampleState: (state: Record<string, unknown>) => Record<string, unknown>;
};

const TextInputPropsSchema = z.object({
  placeholder: z.string().optional(),
  multiline: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
});

const DataTablePropsSchema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
      }),
    )
    .default([]),
  sourceField: z.string().optional(),
  emptyText: z.string().optional(),
});

const DatePickerCardPropsSchema = z.object({
  min: z.string().optional(),
  max: z.string().optional(),
  format: z.string().optional(),
});

const ConfirmCardPropsSchema = z.object({
  title: z.string().optional(),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

const ClientCardPropsSchema = z.object({
  nameField: z.string().optional(),
  ndgField: z.string().optional(),
  subtitleField: z.string().optional(),
});

const DocumentCardPropsSchema = z.object({
  titleField: z.string().optional(),
  descriptionField: z.string().optional(),
  urlField: z.string().optional(),
});

function buildEntry(
  name: string,
  propsSchema: z.ZodType,
  thumbnail: ComponentRegistryEntry['thumbnail'],
  preview: ComponentRegistryEntry['preview'],
  sampleState: ComponentRegistryEntry['sampleState'],
): ComponentRegistryEntry {
  return { name, propsSchema, thumbnail, preview, sampleState };
}

const registry: Record<string, ComponentRegistryEntry> = {
  TextInput: buildEntry(
    'TextInput',
    TextInputPropsSchema,
    TextInputThumbnail,
    TextInputPreview,
    () => ({ value: '' }),
  ),
  DataTable: buildEntry(
    'DataTable',
    DataTablePropsSchema,
    DataTableThumbnail,
    DataTablePreview,
    () => ({
      rows: [
        { id: '1', name: 'Sample Row 1' },
        { id: '2', name: 'Sample Row 2' },
      ],
    }),
  ),
  DatePickerCard: buildEntry(
    'DatePickerCard',
    DatePickerCardPropsSchema,
    DatePickerCardThumbnail,
    DatePickerCardPreview,
    () => ({ date: new Date().toISOString().slice(0, 10) }),
  ),
  ConfirmCard: buildEntry(
    'ConfirmCard',
    ConfirmCardPropsSchema,
    ConfirmCardThumbnail,
    ConfirmCardPreview,
    (state) => ({ state }),
  ),
  ClientCard: buildEntry(
    'ClientCard',
    ClientCardPropsSchema,
    ClientCardThumbnail,
    ClientCardPreview,
    () => ({ name: 'Mario Polito', ndg: 'NDG-42' }),
  ),
  DocumentCard: buildEntry(
    'DocumentCard',
    DocumentCardPropsSchema,
    DocumentCardThumbnail,
    DocumentCardPreview,
    () => ({ title: 'Contratto di estinzione', description: 'PDF 42 KB' }),
  ),
};

function getEntry(name: string): ComponentRegistryEntry | undefined {
  return registry[name];
}

function listComponentNames(): string[] {
  return Object.keys(registry);
}

export const interactiveFlowComponentRegistry = {
  getEntry,
  listComponentNames,
};
