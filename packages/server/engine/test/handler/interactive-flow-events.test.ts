import { describe, expect, it, vi } from 'vitest'
import { interactiveFlowEvents } from '../../src/lib/handler/interactive-flow-events'
import { generateMockEngineConstants } from './test-helper'

describe('interactiveFlowEvents.emit', () => {

    it('POSTs to the engine events endpoint with runId, nodeId, kind, timestamp', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        await interactiveFlowEvents.emit({
            constants: generateMockEngineConstants({ flowRunId: 'run_abc' }),
            event: { stepName: 'interactive_flow', nodeId: 'n1', kind: 'STARTED' },
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toMatch(/\/v1\/engine\/interactive-flow-events\/?$/)
        expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer engineToken')
        const body = JSON.parse((init as { body: string }).body)
        expect(body.flowRunId).toBe('run_abc')
        expect(body.nodeId).toBe('n1')
        expect(body.kind).toBe('STARTED')
        expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('swallows fetch errors without throwing', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
        await expect(interactiveFlowEvents.emit({
            constants: generateMockEngineConstants(),
            event: { stepName: 'x', nodeId: 'y', kind: 'PAUSED' },
        })).resolves.toBeUndefined()
    })

    it('swallows non-2xx responses without throwing', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
        await expect(interactiveFlowEvents.emit({
            constants: generateMockEngineConstants(),
            event: { stepName: 'x', nodeId: 'y', kind: 'COMPLETED' },
        })).resolves.toBeUndefined()
    })
})
