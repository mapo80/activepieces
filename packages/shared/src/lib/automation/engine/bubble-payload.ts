import { z } from 'zod'

const MarkdownBlockSchema = z.object({
    type: z.literal('text'),
    value: z.string(),
})

const DataListColumnSchema = z.object({
    key: z.string(),
    header: z.string(),
    align: z.enum(['left', 'right', 'center']).optional(),
})

const DataListItemSchema = z.object({
    primary: z.string(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    metadata: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    fields: z.record(z.string(), z.string()).optional(),
    payload: z.string(),
    disabled: z.boolean().optional(),
})

const DataListBlockSchema = z.object({
    type: z.literal('data-list'),
    selectMode: z.enum(['single', 'multi']).default('single'),
    layout: z.enum(['cards', 'table', 'single-confirm']).default('cards'),
    columns: z.array(DataListColumnSchema).optional(),
    items: z.array(DataListItemSchema).min(1),
})

const QuickReplyItemSchema = z.object({
    label: z.string(),
    payload: z.string(),
    style: z.enum(['default', 'primary', 'destructive']).default('default'),
})

const QuickRepliesBlockSchema = z.object({
    type: z.literal('quick-replies'),
    replies: z.array(QuickReplyItemSchema).min(1),
})

const DatePickerBlockSchema = z.object({
    type: z.literal('date-picker'),
    format: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'ISO']).default('YYYY-MM-DD'),
    minDate: z.string().optional(),
    maxDate: z.string().optional(),
    locale: z.string().optional(),
    title: z.string().optional(),
})

const PdfViewerBlockSchema = z.object({
    type: z.literal('pdf-viewer'),
    base64: z.string().optional(),
    url: z.string().url().optional(),
    fileName: z.string().optional(),
    title: z.string().optional(),
})

export const BlockSchema = z.discriminatedUnion('type', [
    MarkdownBlockSchema,
    DataListBlockSchema,
    QuickRepliesBlockSchema,
    DatePickerBlockSchema,
    PdfViewerBlockSchema,
])

export const BlocksV1PayloadSchema = z.object({
    type: z.literal('blocks-v1'),
    blocks: z.array(BlockSchema).min(1),
})

export const MarkdownPayloadSchema = z.object({
    type: z.literal('markdown'),
    value: z.string(),
    files: z.array(z.unknown()).optional(),
})

export const BubblePayloadSchema = z.discriminatedUnion('type', [
    MarkdownPayloadSchema,
    BlocksV1PayloadSchema,
])

export type MarkdownBlock = z.infer<typeof MarkdownBlockSchema>
export type DataListColumn = z.infer<typeof DataListColumnSchema>
export type DataListItem = z.infer<typeof DataListItemSchema>
export type DataListBlock = z.infer<typeof DataListBlockSchema>
export type QuickReplyItem = z.infer<typeof QuickReplyItemSchema>
export type QuickRepliesBlock = z.infer<typeof QuickRepliesBlockSchema>
export type DatePickerBlock = z.infer<typeof DatePickerBlockSchema>
export type PdfViewerBlock = z.infer<typeof PdfViewerBlockSchema>
export type Block = z.infer<typeof BlockSchema>
export type BlocksV1Payload = z.infer<typeof BlocksV1PayloadSchema>
export type MarkdownPayload = z.infer<typeof MarkdownPayloadSchema>
export type BubblePayload = z.infer<typeof BubblePayloadSchema>
