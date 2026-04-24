import { FastifyBaseLogger } from 'fastify'
import { databaseConnection } from '../../database/database-connection'
import { commandLayerMetrics } from './metrics'
import { turnLogService } from './turn-log.service'

const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_PREPARE_STALE_SECONDS = 300

let intervalHandle: ReturnType<typeof setInterval> | null = null
let loggerRef: FastifyBaseLogger | null = null

async function tick(): Promise<void> {
    if (!loggerRef) return
    try {
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: DEFAULT_PREPARE_STALE_SECONDS })
        if (reclaimed > 0) {
            loggerRef.info({ reclaimed }, '[lock-recovery] reclaimed stale turn logs')
            commandLayerMetrics.recordStaleReclaim({ count: reclaimed })
        }
    }
    catch (err) {
        commandLayerMetrics.recordStaleReclaimError()
        loggerRef.error({ err }, '[lock-recovery] tick failed')
    }
}

function start({ log, pollIntervalMs }: { log: FastifyBaseLogger, pollIntervalMs?: number }): void {
    if (intervalHandle) return
    loggerRef = log
    intervalHandle = setInterval(() => {
        void tick()
    }, pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    if (typeof intervalHandle.unref === 'function') intervalHandle.unref()
    log.info('[lock-recovery] started')
}

function stop(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle)
        intervalHandle = null
    }
    loggerRef = null
}

export const lockRecoveryDaemon = {
    start,
    stop,
}
