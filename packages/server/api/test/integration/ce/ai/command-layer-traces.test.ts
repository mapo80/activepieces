import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { commandLayerTracing } from '../../../../src/app/ai/command-layer/tracing'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => {
    await setupTestEnvironment()
})
afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(() => {
    commandLayerTracing.clear()
})

describe('command-layer traces', () => {
    it('A-07.1: empty summary when no spans recorded', () => {
        const s = commandLayerTracing.summarize()
        expect(s.totalSpans).toBe(0)
        expect(s.byName).toEqual({})
    })

    it('A-07.2: withSpan records duration + count by name', async () => {
        await commandLayerTracing.withSpan({
            name: 'test-span-A07',
            fn: async () => {
                await new Promise((r) => setTimeout(r, 5))
                return 1
            },
        })
        const s = commandLayerTracing.summarize()
        expect(s.byName['test-span-A07']).toBeDefined()
        expect(s.byName['test-span-A07'].count).toBe(1)
        expect(s.byName['test-span-A07'].avgMs).toBeGreaterThanOrEqual(0)
        expect(s.totalSpans).toBe(1)
    })

    it('A-07.3: errorRate computed from rejected spans', async () => {
        await commandLayerTracing.withSpan({ name: 'err-span-A07', fn: async () => 1 })
        await commandLayerTracing.withSpan({
            name: 'err-span-A07',
            fn: async () => {
                throw new Error('boom')
            },
        }).catch(() => undefined)
        const s = commandLayerTracing.summarize()
        expect(s.byName['err-span-A07'].count).toBe(2)
        expect(s.byName['err-span-A07'].errorRate).toBeCloseTo(0.5, 1)
    })

    it('A-07.4: spanSync records sync spans + propagates throws', () => {
        commandLayerTracing.spanSync({ name: 'sync-A07', fn: () => 'ok' })
        expect(() => commandLayerTracing.spanSync({
            name: 'sync-A07',
            fn: () => {
                throw new Error('sync-error')
            },
        })).toThrow('sync-error')
        const s = commandLayerTracing.summarize()
        expect(s.byName['sync-A07'].count).toBe(2)
        expect(s.byName['sync-A07'].errorRate).toBeCloseTo(0.5, 1)
    })

    it('A-07.5: snapshot returns immutable copy of recorded spans', async () => {
        await commandLayerTracing.withSpan({ name: 'snap-A07', fn: async () => 1 })
        const snap = commandLayerTracing.snapshot()
        expect(snap).toHaveLength(1)
        snap.length = 0
        const snap2 = commandLayerTracing.snapshot()
        expect(snap2).toHaveLength(1)
    })

    it('A-07.6: attributes are stored on the span record', async () => {
        await commandLayerTracing.withSpan({
            name: 'attr-A07',
            attributes: { sessionId: 's-1', turnId: 't-1' },
            fn: async () => 1,
        })
        const snap = commandLayerTracing.snapshot()
        const found = snap.find((s) => s.name === 'attr-A07')
        expect(found?.attributes).toEqual({ sessionId: 's-1', turnId: 't-1' })
    })

    it('A-07.7: clear() resets buffer to zero', async () => {
        await commandLayerTracing.withSpan({ name: 'clr-A07', fn: async () => 1 })
        expect(commandLayerTracing.summarize().totalSpans).toBe(1)
        commandLayerTracing.clear()
        expect(commandLayerTracing.summarize().totalSpans).toBe(0)
    })
})
