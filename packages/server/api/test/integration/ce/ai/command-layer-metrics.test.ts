import { beforeEach, describe, expect, it } from 'vitest'
import { commandLayerMetrics } from '../../../../src/app/ai/command-layer/metrics'

describe('command-layer metrics snapshot', () => {
    beforeEach(() => {
        commandLayerMetrics.reset()
    })

    it('A-06.1: snapshot is empty after reset', () => {
        const snap = commandLayerMetrics.snapshot()
        expect(snap).toEqual({
            leaseAcquired: 0,
            leaseConflict: 0,
            leaseReplay: 0,
            leaseFailedPrevious: 0,
            staleReclaim: 0,
            staleReclaimError: 0,
            outboxPublished: 0,
            outboxRetry: 0,
            outboxDead: 0,
            outboxError: 0,
            casConflict: 0,
        })
    })

    it('A-06.2: lease outcomes increment correct counters', () => {
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'acquired' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'acquired' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'locked-by-other' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'replay' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'failed-previous' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'unknown-error' })
        const snap = commandLayerMetrics.snapshot()
        expect(snap.leaseAcquired).toBe(2)
        expect(snap.leaseConflict).toBe(2)
        expect(snap.leaseReplay).toBe(1)
        expect(snap.leaseFailedPrevious).toBe(1)
    })

    it('A-06.3: outbox + stale reclaim metrics aggregate as expected', () => {
        commandLayerMetrics.recordOutboxPublished({ eventType: 'X' })
        commandLayerMetrics.recordOutboxPublished({ eventType: 'Y' })
        commandLayerMetrics.recordOutboxRetry({ eventType: 'Z', dead: false })
        commandLayerMetrics.recordOutboxRetry({ eventType: 'Z', dead: true })
        commandLayerMetrics.recordOutboxError()
        commandLayerMetrics.recordStaleReclaim({ count: 3 })
        commandLayerMetrics.recordStaleReclaim({ count: 2 })
        commandLayerMetrics.recordStaleReclaimError()
        commandLayerMetrics.recordCasConflict()
        const snap = commandLayerMetrics.snapshot()
        expect(snap.outboxPublished).toBe(2)
        expect(snap.outboxRetry).toBe(2)
        expect(snap.outboxDead).toBe(1)
        expect(snap.outboxError).toBe(1)
        expect(snap.staleReclaim).toBe(5)
        expect(snap.staleReclaimError).toBe(1)
        expect(snap.casConflict).toBe(1)
    })

    it('A-06.4: snapshot returns a copy (mutating returned object does not affect counters)', () => {
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'acquired' })
        const snap = commandLayerMetrics.snapshot()
        snap.leaseAcquired = 999
        const fresh = commandLayerMetrics.snapshot()
        expect(fresh.leaseAcquired).toBe(1)
    })
})
