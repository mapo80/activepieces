import { describe, expect, it } from 'vitest'
import {
    BubblePayloadSchema,
    BlockSchema,
    DataListBlock,
    QuickRepliesBlock,
    MarkdownPayload,
    BlocksV1Payload,
} from '../../src/lib/automation/engine/bubble-payload'

describe('bubble-payload Zod schemas', () => {
    it('accepts legacy markdown payload', () => {
        const payload: MarkdownPayload = {
            type: 'markdown',
            value: 'Ciao, ho trovato 1 cliente.',
        }
        const parsed = BubblePayloadSchema.parse(payload)
        expect(parsed.type).toBe('markdown')
    })

    it('accepts blocks-v1 payload with text + data-list + quick-replies', () => {
        const payload: BlocksV1Payload = {
            type: 'blocks-v1',
            blocks: [
                { type: 'text', value: 'Ho trovato 1 cliente' },
                {
                    type: 'data-list',
                    selectMode: 'single',
                    items: [
                        { primary: '11255521', title: 'BELLAFRONTE GIANLUCA', subtitle: 'PRIVATO', payload: '11255521' },
                    ],
                },
                {
                    type: 'quick-replies',
                    replies: [
                        { label: 'Annulla', payload: 'annulla', style: 'destructive' },
                    ],
                },
            ],
        }
        const parsed = BubblePayloadSchema.parse(payload)
        expect(parsed.type).toBe('blocks-v1')
        expect((parsed as BlocksV1Payload).blocks).toHaveLength(3)
    })

    it('rejects unknown top-level type', () => {
        expect(() => BubblePayloadSchema.parse({ type: 'html', value: '<p>x</p>' })).toThrow()
    })

    it('rejects empty blocks array', () => {
        expect(() => BubblePayloadSchema.parse({ type: 'blocks-v1', blocks: [] })).toThrow()
    })

    it('rejects data-list with no items', () => {
        expect(() => BlockSchema.parse({ type: 'data-list', selectMode: 'single', items: [] })).toThrow()
    })

    it('data-list defaults selectMode to single', () => {
        const parsed = BlockSchema.parse({
            type: 'data-list',
            items: [{ primary: 'p', title: 't', payload: 'p' }],
        }) as DataListBlock
        expect(parsed.selectMode).toBe('single')
    })

    it('quick-reply item defaults style to default', () => {
        const parsed = BlockSchema.parse({
            type: 'quick-replies',
            replies: [{ label: 'Sì', payload: 'sì' }],
        }) as QuickRepliesBlock
        expect(parsed.replies[0].style).toBe('default')
    })

    it('rejects data-list item missing payload', () => {
        expect(() => BlockSchema.parse({
            type: 'data-list',
            items: [{ primary: 'p', title: 't' }],
        })).toThrow()
    })
})
