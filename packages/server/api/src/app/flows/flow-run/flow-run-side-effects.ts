import { ApplicationEventName,
    FlowRun,
    FlowRunStatus,
    isFlowRunStateTerminal,
    tryCatch,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { agenticRunStateEmitter, RunState } from '../../agentic/agentic-run-state-emitter'
import { applicationEvents } from '../../helper/application-events'
import { flowRunHooks } from './flow-run-hooks'
import { waitpointService } from './waitpoint/waitpoint-service'

export const flowRunSideEffects = (log: FastifyBaseLogger) => ({
    async onFinish(flowRun: FlowRun): Promise<void> {
        if (!isFlowRunStateTerminal({
            status: flowRun.status,
            ignoreInternalError: true,
        })) {
            return
        }
        await waitpointService(log).deleteByFlowRunId(flowRun.id)
        await flowRunHooks(log).onFinish(flowRun)
        applicationEvents(log).sendWorkerEvent(flowRun.projectId, {
            action: ApplicationEventName.FLOW_RUN_FINISHED,
            data: {
                flowRun,
            },
        })
        await emitAgenticRunState({ log, flowRun })
    },
    async onPause(flowRun: FlowRun): Promise<void> {
        if (flowRun.status !== FlowRunStatus.PAUSED) {
            return
        }
        await emitAgenticRunState({ log, flowRun })
    },
    async onResume(flowRun: FlowRun): Promise<void> {
        applicationEvents(log).sendWorkerEvent(flowRun.projectId, {
            action: ApplicationEventName.FLOW_RUN_RESUMED,
            data: {
                flowRun,
            },
        })
    },
    async onRetry(flowRun: FlowRun): Promise<void> {
        applicationEvents(log).sendWorkerEvent(flowRun.projectId, {
            action: ApplicationEventName.FLOW_RUN_RETRIED,
            data: {
                flowRun,
            },
        })
    },
    async onStart(flowRun: FlowRun): Promise<void> {

        applicationEvents(log).sendWorkerEvent(flowRun.projectId, {
            action: ApplicationEventName.FLOW_RUN_STARTED,
            data: {
                flowRun,
            },
        })
    },
})

async function emitAgenticRunState({ log, flowRun }: { log: FastifyBaseLogger, flowRun: FlowRun }): Promise<void> {
    const runState = mapFlowRunStateForAgentic(flowRun.status)
    if (runState === undefined) {
        return
    }
    const emitter = getAgenticEmitter(log)
    const eventEpoch = deriveEventEpoch(flowRun)
    const providerEpoch = deriveProviderEpoch(flowRun)
    const result = await tryCatch(() => emitter.emit({
        platformRunId: derivePlatformRunId(flowRun),
        externalRunId: flowRun.id,
        runVersion: deriveRunVersion(eventEpoch, providerEpoch),
        runState,
        eventEpoch,
        ...(providerEpoch !== undefined ? { providerEpoch } : {}),
        tenantId: flowRun.environment,
        projectId: flowRun.projectId,
        timestamp: new Date().toISOString(),
        data: extractAgenticData(flowRun),
    }))
    if (result.error !== null) {
        log.warn({ runId: flowRun.id, err: result.error.message }, 'agentic emitter: unexpected exception, ignored (best-effort)')
    }
}

function mapFlowRunStateForAgentic(status: FlowRunStatus): RunState | undefined {
    switch (status) {
        case FlowRunStatus.PAUSED:
            return 'PAUSED'
        case FlowRunStatus.SUCCEEDED:
            return 'SUCCEEDED'
        case FlowRunStatus.FAILED:
        case FlowRunStatus.INTERNAL_ERROR:
        case FlowRunStatus.QUOTA_EXCEEDED:
        case FlowRunStatus.MEMORY_LIMIT_EXCEEDED:
        case FlowRunStatus.LOG_SIZE_EXCEEDED:
        case FlowRunStatus.TIMEOUT:
            return 'FAILED'
        case FlowRunStatus.CANCELED:
            return 'CANCELED'
        default:
            return undefined
    }
}

function deriveRunVersion(eventEpoch: number, providerEpoch?: number): number {
    return providerEpoch ?? eventEpoch
}

function deriveEventEpoch(flowRun: FlowRun): number {
    const updated = flowRun.updated ?? new Date().toISOString()
    const epoch = new Date(updated).getTime()
    return Number.isFinite(epoch) ? epoch : Date.now()
}

function derivePlatformRunId(flowRun: FlowRun): string {
    return readNestedString(flowRun, ['metadata', 'platformRunId'])
        ?? readNestedString(flowRun, ['agentic', 'platformRunId'])
        ?? readNestedString(flowRun, ['input', 'platformRunId'])
        ?? readNestedString(flowRun, ['payload', 'platformRunId'])
        ?? readStepOutputString(flowRun, 'platformRunId')
        ?? flowRun.id
}

function deriveProviderEpoch(flowRun: FlowRun): number | undefined {
    const value = readNestedNumber(flowRun, ['metadata', 'providerEpoch'])
        ?? readNestedNumber(flowRun, ['agentic', 'providerEpoch'])
        ?? readNestedNumber(flowRun, ['input', 'providerEpoch'])
        ?? readNestedNumber(flowRun, ['payload', 'providerEpoch'])
        ?? readStepOutputNumber(flowRun, 'providerEpoch')
    return value !== undefined && Number.isFinite(value) ? value : undefined
}

function readNestedString(source: unknown, path: string[]): string | undefined {
    const value = readNestedValue(source, path)
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function readNestedNumber(source: unknown, path: string[]): number | undefined {
    const value = readNestedValue(source, path)
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
}

function readNestedValue(source: unknown, path: string[]): unknown {
    let cursor: unknown = source
    for (const key of path) {
        if (cursor === null || typeof cursor !== 'object') return undefined
        cursor = (cursor as Record<string, unknown>)[key]
    }
    return cursor
}

function extractAgenticData(flowRun: FlowRun): Record<string, unknown> | undefined {
    const data: Record<string, unknown> = {}
    const steps = extractStepStates(flowRun)
    if (steps !== undefined) {
        data.steps = steps
        mergeStepOutputs(data, steps)
    }
    if (flowRun.failedStep?.name !== undefined) data.failedStepName = flowRun.failedStep.name
    const durationMs = calculateDurationMs(flowRun)
    if (durationMs !== undefined) data.durationMs = durationMs
    if (flowRun.stepsCount !== undefined) data.tasksExecuted = flowRun.stepsCount
    return Object.keys(data).length === 0 ? undefined : data
}

function readStepOutputString(flowRun: FlowRun, key: string): string | undefined {
    const value = readStepOutputValue(flowRun, key)
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function readStepOutputNumber(flowRun: FlowRun, key: string): number | undefined {
    const value = readStepOutputValue(flowRun, key)
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
}

function readStepOutputValue(flowRun: FlowRun, key: string): unknown {
    const steps = readNestedValue(flowRun, ['steps'])
    if (steps === null || typeof steps !== 'object') return undefined
    for (const step of Object.values(steps as Record<string, unknown>)) {
        const value = readNestedValue(step, ['output', key])
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value
        }
    }
    return undefined
}

function extractStepStates(flowRun: FlowRun): Record<string, unknown> | undefined {
    const rawSteps = readNestedValue(flowRun, ['steps'])
    if (rawSteps === null || typeof rawSteps !== 'object') return undefined
    const out: Record<string, unknown> = {}
    for (const [stepName, rawStep] of Object.entries(rawSteps as Record<string, unknown>)) {
        if (rawStep === null || typeof rawStep !== 'object') continue
        const step = compactJsonObject(rawStep as Record<string, unknown>)
        if (Object.keys(step).length > 0) out[stepName] = step
    }
    return Object.keys(out).length === 0 ? undefined : out
}

function mergeStepOutputs(target: Record<string, unknown>, steps: Record<string, unknown>): void {
    for (const step of Object.values(steps)) {
        const output = readNestedValue(step, ['output'])
        if (output === null || typeof output !== 'object') continue
        for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
            if (value !== undefined && value !== null && target[key] === undefined) {
                target[key] = value
            }
        }
    }
}

function compactJsonObject(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
        const compacted = compactJsonValue(value)
        if (compacted !== undefined) out[key] = compacted
    }
    return out
}

function compactJsonValue(value: unknown): unknown {
    if (value === undefined) return undefined
    if (Array.isArray(value)) {
        return value.map(compactJsonValue).filter(item => item !== undefined)
    }
    if (value !== null && typeof value === 'object') {
        return compactJsonObject(value as Record<string, unknown>)
    }
    return value
}

function calculateDurationMs(flowRun: FlowRun): number | undefined {
    if (flowRun.startTime === undefined || flowRun.startTime === null
        || flowRun.finishTime === undefined || flowRun.finishTime === null) {
        return undefined
    }
    const start = new Date(flowRun.startTime).getTime()
    const finish = new Date(flowRun.finishTime).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(finish)) {
        return undefined
    }
    const duration = finish - start
    return duration >= 0 ? duration : undefined
}

function getAgenticEmitter(log: FastifyBaseLogger): ReturnType<typeof agenticRunStateEmitter> {
    if (cachedEmitter === undefined) {
        cachedEmitter = agenticRunStateEmitter({ log })
    }
    return cachedEmitter
}

let cachedEmitter: ReturnType<typeof agenticRunStateEmitter> | undefined
