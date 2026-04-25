type Counters = {
    leaseAcquired: number
    leaseConflict: number
    leaseReplay: number
    leaseFailedPrevious: number
    staleReclaim: number
    staleReclaimError: number
    outboxPublished: number
    outboxRetry: number
    outboxDead: number
    outboxError: number
    casConflict: number
}

const counters: Counters = {
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
}

function recordLeaseOutcome({ outcome }: { outcome: 'acquired' | 'locked-by-other' | 'replay' | 'failed-previous' | 'unknown-error' }): void {
    switch (outcome) {
        case 'acquired': counters.leaseAcquired++; break
        case 'locked-by-other': counters.leaseConflict++; break
        case 'replay': counters.leaseReplay++; break
        case 'failed-previous': counters.leaseFailedPrevious++; break
        case 'unknown-error': counters.leaseConflict++; break
    }
}

function recordStaleReclaim({ count }: { count: number }): void {
    counters.staleReclaim += count
}

function recordStaleReclaimError(): void {
    counters.staleReclaimError++
}

function recordOutboxPublished(_args: { eventType: string }): void {
    counters.outboxPublished++
}

function recordOutboxRetry({ dead }: { eventType: string, dead: boolean }): void {
    counters.outboxRetry++
    if (dead) counters.outboxDead++
}

function recordOutboxError(): void {
    counters.outboxError++
}

function recordCasConflict(): void {
    counters.casConflict++
}

function snapshot(): Counters {
    return { ...counters }
}

function snapshotPrometheus(): string {
    const lines: string[] = []
    for (const [k, v] of Object.entries(counters) as Array<[keyof Counters, number]>) {
        lines.push(`# TYPE command_layer_${k} counter`)
        lines.push(`command_layer_${k} ${v}`)
    }
    return lines.join('\n') + '\n'
}

function reset(): void {
    for (const key of Object.keys(counters) as Array<keyof Counters>) {
        counters[key] = 0
    }
}

export const commandLayerMetrics = {
    recordLeaseOutcome,
    recordStaleReclaim,
    recordStaleReclaimError,
    recordOutboxPublished,
    recordOutboxRetry,
    recordOutboxError,
    recordCasConflict,
    snapshot,
    snapshotPrometheus,
    reset,
}
