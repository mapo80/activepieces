import { beforeEach, describe, expect, it } from 'vitest'
import { commandLayerMetrics } from '../../../../src/app/ai/command-layer/metrics'

describe('commandLayerMetrics.snapshotPrometheus', () => {
    beforeEach(() => commandLayerMetrics.reset())

    it('emits TYPE + counter lines for each metric', () => {
        commandLayerMetrics.recordOutboxPublished({ eventType: 'X' })
        commandLayerMetrics.recordCasConflict()
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out).toMatch(/# TYPE command_layer_outboxPublished counter/)
        expect(out).toMatch(/command_layer_outboxPublished 1/)
        expect(out).toMatch(/command_layer_casConflict 1/)
    })

    it('returns 0-counter for unrecorded metrics', () => {
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out).toMatch(/command_layer_leaseAcquired 0/)
    })

    it('ends with trailing newline', () => {
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out.endsWith('\n')).toBe(true)
    })

    it('emits all 11 counters with TYPE + value lines (22 total)', () => {
        const out = commandLayerMetrics.snapshotPrometheus()
        const typeLines = out.split('\n').filter((l) => l.startsWith('# TYPE'))
        const valueLines = out.split('\n').filter((l) => l.match(/^command_layer_/))
        expect(typeLines.length).toBe(11)
        expect(valueLines.length).toBe(11)
    })

    it('reflects updated counters after recording', () => {
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'acquired' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'acquired' })
        commandLayerMetrics.recordLeaseOutcome({ outcome: 'replay' })
        const out = commandLayerMetrics.snapshotPrometheus()
        expect(out).toMatch(/command_layer_leaseAcquired 2/)
        expect(out).toMatch(/command_layer_leaseReplay 1/)
    })
})
