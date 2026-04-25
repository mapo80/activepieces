type SpanRecord = {
    name: string
    attributes: Record<string, unknown>
    startTimeMs: number
    endTimeMs?: number
    durationMs?: number
    error?: string
}

const traceBuffer: SpanRecord[] = []
const MAX_BUFFER_SIZE = 1000

function record(span: SpanRecord): void {
    traceBuffer.push(span)
    if (traceBuffer.length > MAX_BUFFER_SIZE) {
        traceBuffer.shift()
    }
}

async function withSpan<T>({ name, attributes, fn }: {
    name: string
    attributes?: Record<string, unknown>
    fn: () => Promise<T>
}): Promise<T> {
    const startTimeMs = Date.now()
    try {
        const result = await fn()
        const endTimeMs = Date.now()
        record({
            name,
            attributes: attributes ?? {},
            startTimeMs,
            endTimeMs,
            durationMs: endTimeMs - startTimeMs,
        })
        return result
    }
    catch (err) {
        const endTimeMs = Date.now()
        record({
            name,
            attributes: attributes ?? {},
            startTimeMs,
            endTimeMs,
            durationMs: endTimeMs - startTimeMs,
            error: String(err).slice(0, 200),
        })
        throw err
    }
}

function spanSync<T>({ name, attributes, fn }: {
    name: string
    attributes?: Record<string, unknown>
    fn: () => T
}): T {
    const startTimeMs = Date.now()
    try {
        const result = fn()
        const endTimeMs = Date.now()
        record({
            name,
            attributes: attributes ?? {},
            startTimeMs,
            endTimeMs,
            durationMs: endTimeMs - startTimeMs,
        })
        return result
    }
    catch (err) {
        const endTimeMs = Date.now()
        record({
            name,
            attributes: attributes ?? {},
            startTimeMs,
            endTimeMs,
            durationMs: endTimeMs - startTimeMs,
            error: String(err).slice(0, 200),
        })
        throw err
    }
}

function snapshot(): SpanRecord[] {
    return [...traceBuffer]
}

function clear(): void {
    traceBuffer.length = 0
}

function summarize(): {
    totalSpans: number
    byName: Record<string, { count: number, avgMs: number, p95Ms: number, errorRate: number }>
} {
    const grouped = new Map<string, SpanRecord[]>()
    for (const s of traceBuffer) {
        if (s.durationMs === undefined || s.durationMs === null) continue
        if (!grouped.has(s.name)) grouped.set(s.name, [])
        grouped.get(s.name)!.push(s)
    }
    const byName: Record<string, { count: number, avgMs: number, p95Ms: number, errorRate: number }> = {}
    for (const [name, spans] of grouped) {
        const durations = spans.map(s => s.durationMs!).sort((a, b) => a - b)
        const avg = durations.reduce((s, n) => s + n, 0) / durations.length
        const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95))
        const errors = spans.filter(s => s.error).length
        byName[name] = {
            count: spans.length,
            avgMs: Math.round(avg),
            p95Ms: durations[p95Index],
            errorRate: errors / spans.length,
        }
    }
    return { totalSpans: traceBuffer.length, byName }
}

export const commandLayerTracing = {
    withSpan,
    spanSync,
    record,
    snapshot,
    clear,
    summarize,
}

export type { SpanRecord }
