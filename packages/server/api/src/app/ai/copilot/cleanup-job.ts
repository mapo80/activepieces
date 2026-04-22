import { FastifyBaseLogger } from 'fastify'
import { copilotSessionStore } from './session-store'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000

let intervalHandle: ReturnType<typeof setInterval> | null = null

function start(log: FastifyBaseLogger): void {
    if (intervalHandle) return
    intervalHandle = setInterval(() => {
        try {
            const removed = copilotSessionStore.cleanupStale(TWENTY_FOUR_HOURS_MS)
            if (removed > 0) log.info({ removed }, '[copilot-cleanup] removed stale sessions')
        }
        catch (err) {
            log.error({ err }, '[copilot-cleanup] cleanup failed')
        }
    }, CLEANUP_INTERVAL_MS)
    if (typeof intervalHandle.unref === 'function') intervalHandle.unref()
}

function stop(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle)
        intervalHandle = null
    }
}

export const copilotCleanupJob = {
    start,
    stop,
}
