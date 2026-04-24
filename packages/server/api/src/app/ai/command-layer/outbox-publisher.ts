import { randomUUID } from 'node:crypto'
import { FastifyBaseLogger } from 'fastify'
import { commandLayerMetrics } from './metrics'
import { outboxService } from './outbox.service'

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_CLAIM_TTL_SECONDS = 30
const DEFAULT_MAX_ATTEMPTS = 10
const DEFAULT_BACKOFF_CAP_SECONDS = 300

let intervalHandle: ReturnType<typeof setInterval> | null = null
let publisherId: string | null = null
let emitter: TurnEventEmitter | null = null
let loggerRef: FastifyBaseLogger | null = null

async function tick(): Promise<void> {
    if (!emitter || !loggerRef || !publisherId) return
    try {
        const batch = await outboxService.claimNextSessionBatch({ publisherId, claimTtlSeconds: DEFAULT_CLAIM_TTL_SECONDS })
        if (batch.length === 0) return
        for (const row of batch) {
            try {
                await emitter({
                    outboxEventId: row.outboxEventId,
                    turnId: row.turnId,
                    sessionId: row.sessionId,
                    flowRunId: row.flowRunId,
                    sessionSequence: row.sessionSequence,
                    eventType: row.eventType,
                    payload: row.payload,
                })
                await outboxService.markPublished({ outboxEventId: row.outboxEventId })
                commandLayerMetrics.recordOutboxPublished({ eventType: row.eventType })
            }
            catch (err) {
                const backoff = Math.min(DEFAULT_BACKOFF_CAP_SECONDS, 2 ** 1)
                const { dead } = await outboxService.markRetry({
                    outboxEventId: row.outboxEventId,
                    backoffSeconds: backoff,
                    maxAttempts: DEFAULT_MAX_ATTEMPTS,
                })
                commandLayerMetrics.recordOutboxRetry({ eventType: row.eventType, dead })
                loggerRef.warn({ err, outboxEventId: row.outboxEventId, dead }, '[outbox-publisher] emit failed')
            }
        }
    }
    catch (err) {
        commandLayerMetrics.recordOutboxError()
        loggerRef?.error({ err }, '[outbox-publisher] tick failed')
    }
}

function start({ log, emit, pollIntervalMs }: StartInput): void {
    if (intervalHandle) return
    publisherId = randomUUID()
    emitter = emit
    loggerRef = log
    intervalHandle = setInterval(() => {
        void tick()
    }, pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    if (typeof intervalHandle.unref === 'function') intervalHandle.unref()
    log.info({ publisherId }, '[outbox-publisher] started')
}

function stop(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle)
        intervalHandle = null
    }
    publisherId = null
    emitter = null
    loggerRef = null
}

export const outboxPublisher = {
    start,
    stop,
}

export type TurnEventEmitter = (event: EmittedTurnEvent) => Promise<void> | void

export type EmittedTurnEvent = {
    outboxEventId: string
    turnId: string
    sessionId: string
    flowRunId: string
    sessionSequence: string
    eventType: string
    payload: unknown
}

export type StartInput = {
    log: FastifyBaseLogger
    emit: TurnEventEmitter
    pollIntervalMs?: number
}
