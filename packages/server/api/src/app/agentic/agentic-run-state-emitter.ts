import { createHmac } from 'node:crypto'

import { tryCatch } from '@activepieces/shared'
import { safeHttp } from '@activepieces/server-utils'
import { FastifyBaseLogger } from 'fastify'

async function postOnce({
    url,
    body,
    secret,
    timeoutMs,
}: {
    url: string
    body: string
    secret: string
    timeoutMs: number
}): Promise<{ status: number }> {
    const signature = signPayload({ body, secret })
    const response = await safeHttp.axios.post(url, body, {
        timeout: timeoutMs,
        headers: {
            'Content-Type': 'application/json',
            'X-AP-Signature': signature,
        },
        validateStatus: (status: number) => status >= 200 && status < 600,
    })
    return { status: response.status }
}

function signPayload({ body, secret }: { body: string; secret: string }): string {
    const hex = createHmac('sha256', secret).update(body).digest('hex')
    return `sha256=${hex}`
}

function shouldEmit(state: string): boolean {
    return TRACKED_STATES.has(state)
}

function backoffDelayMs(attempt: number): number {
    return BASE_BACKOFF_MS * Math.pow(2, attempt - 1)
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function envOrUndefined(name: string): string | undefined {
    const value = process.env[name]
    if (value === undefined || value === null) return undefined
    const trimmed = String(value).trim()
    return trimmed.length === 0 ? undefined : trimmed
}

export function agenticRunStateEmitter({
    log,
    pushUrl = envOrUndefined('AGENTIC_PUSH_URL'),
    secret = envOrUndefined('AP_AGENTIC_WEBHOOK_SECRET'),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = MAX_ATTEMPTS,
}: {
    log: FastifyBaseLogger
    pushUrl?: string | undefined
    secret?: string | undefined
    timeoutMs?: number
    maxAttempts?: number
}): AgenticRunStateEmitter {
    return {
        async emit(payload: RunStatePayload): Promise<EmitOutcome> {
            if (!shouldEmit(payload.runState)) {
                return { delivered: false, reason: 'state-not-tracked' }
            }
            if (pushUrl === undefined) {
                log.debug({ runId: payload.platformRunId, state: payload.runState }, 'agentic emitter: AGENTIC_PUSH_URL missing, skip')
                return { delivered: false, reason: 'push-url-missing' }
            }
            if (secret === undefined) {
                log.warn({ runId: payload.platformRunId }, 'agentic emitter: AP_AGENTIC_WEBHOOK_SECRET missing, skip emission')
                return { delivered: false, reason: 'secret-missing' }
            }
            const body = JSON.stringify(payload)
            const url = `${pushUrl.replace(/\/+$/, '')}/agentic/v1/webhooks/run-state`
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const result = await tryCatch(() => postOnce({ url, body, secret, timeoutMs }))
                if (result.error === null) {
                    const status = result.data.status
                    if (status >= 200 && status < 300) {
                        log.info({
                            runId: payload.platformRunId,
                            state: payload.runState,
                            attempt,
                            status,
                        }, 'agentic emitter: delivered')
                        return { delivered: true, status, attempts: attempt }
                    }
                    if (status >= 400 && status < 500) {
                        log.warn({
                            runId: payload.platformRunId,
                            state: payload.runState,
                            status,
                        }, 'agentic emitter: 4xx response, no retry')
                        return { delivered: false, status, reason: 'client-error', attempts: attempt }
                    }
                    log.warn({
                        runId: payload.platformRunId,
                        state: payload.runState,
                        attempt,
                        status,
                    }, 'agentic emitter: 5xx response, will retry')
                }
                else {
                    log.warn({
                        runId: payload.platformRunId,
                        state: payload.runState,
                        attempt,
                        err: result.error.message,
                    }, 'agentic emitter: network error, will retry')
                }
                if (attempt < maxAttempts) {
                    await delay(backoffDelayMs(attempt))
                }
            }
            log.error({
                runId: payload.platformRunId,
                state: payload.runState,
                attempts: maxAttempts,
            }, 'agentic emitter: delivery failed after retries')
            return { delivered: false, reason: 'retries-exhausted', attempts: maxAttempts }
        },
    }
}

const TRACKED_STATES = new Set(['PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELED'])
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 200

export type RunState = 'PAUSED' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'

export type RunStatePayload = {
    platformRunId: string
    externalRunId?: string
    runVersion: number
    runState: RunState
    eventEpoch: number
    providerEpoch?: number
    tenantId?: string
    projectId?: string
    data?: Record<string, unknown>
    timestamp: string
}

export type EmitOutcome = {
    delivered: boolean
    status?: number
    attempts?: number
    reason?: 'state-not-tracked' | 'push-url-missing' | 'secret-missing' | 'client-error' | 'retries-exhausted'
}

export type AgenticRunStateEmitter = {
    emit(payload: RunStatePayload): Promise<EmitOutcome>
}
