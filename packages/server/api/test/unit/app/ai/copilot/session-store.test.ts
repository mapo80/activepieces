import { describe, expect, it } from 'vitest'
import { copilotSessionStore } from '../../../../../src/app/ai/copilot/session-store'
import { FlowVersion } from '@activepieces/shared'

function fakeFV(id: string = 'fv1'): FlowVersion {
    return {
        id,
        flowId: 'f1',
        trigger: { type: 'EMPTY', name: 'trigger', displayName: 'start', valid: true, settings: {} },
        created: '2026-01-01',
        updated: '2026-01-01T00:00:00Z',
        displayName: 'x',
        schemaVersion: '1',
    } as unknown as FlowVersion
}

describe('copilotSessionStore', () => {
    it('create → get returns same session and deep-keeps snapshot', () => {
        const s = copilotSessionStore.create({
            userId: 'u1',
            projectId: 'p1',
            platformId: 'pl1',
            flowId: 'f1',
            flowVersion: fakeFV(),
            scope: 'EMPTY_OR_NEW',
        })
        const got = copilotSessionStore.get(s.id)
        expect(got?.id).toBe(s.id)
        expect(got?.snapshotFlowVersion.id).toBe('fv1')
        expect(got?.appliedOps).toEqual([])
    })

    it('update patches fields', () => {
        const s = copilotSessionStore.create({
            userId: 'u1',
            projectId: 'p1',
            platformId: 'pl1',
            flowId: 'f1',
            flowVersion: fakeFV(),
            scope: 'EMPTY_OR_NEW',
        })
        const updated = copilotSessionStore.update(s.id, { flowVersionId: 'fv2' })
        expect(updated?.flowVersionId).toBe('fv2')
        expect(updated?.lastTurnAt).toBeDefined()
    })

    it('cleanupStale removes sessions older than the threshold', () => {
        const s = copilotSessionStore.create({
            userId: 'u2',
            projectId: 'p1',
            platformId: 'pl1',
            flowId: 'f1',
            flowVersion: fakeFV(),
            scope: 'EMPTY_OR_NEW',
        })
        copilotSessionStore.update(s.id, {})
        const removed = copilotSessionStore.cleanupStale(-1)
        expect(removed).toBeGreaterThanOrEqual(1)
        expect(copilotSessionStore.get(s.id)).toBeUndefined()
    })

    it('delete removes and returns true', () => {
        const s = copilotSessionStore.create({
            userId: 'u3',
            projectId: 'p1',
            platformId: 'pl1',
            flowId: 'f1',
            flowVersion: fakeFV(),
            scope: 'EMPTY_OR_NEW',
        })
        expect(copilotSessionStore.delete(s.id)).toBe(true)
        expect(copilotSessionStore.delete('missing')).toBe(false)
    })
})
