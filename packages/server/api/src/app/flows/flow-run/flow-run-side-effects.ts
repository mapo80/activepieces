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
        ?? flowRun.id
}

function deriveProviderEpoch(flowRun: FlowRun): number | undefined {
    const value = readNestedNumber(flowRun, ['metadata', 'providerEpoch'])
        ?? readNestedNumber(flowRun, ['agentic', 'providerEpoch'])
        ?? readNestedNumber(flowRun, ['input', 'providerEpoch'])
        ?? readNestedNumber(flowRun, ['payload', 'providerEpoch'])
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
    if (flowRun.failedStep?.name !== undefined) data.failedStepName = flowRun.failedStep.name
    if (flowRun.duration !== undefined) data.durationMs = flowRun.duration
    if (flowRun.tasks !== undefined) data.tasksExecuted = flowRun.tasks
    return Object.keys(data).length === 0 ? undefined : data
}

function getAgenticEmitter(log: FastifyBaseLogger): ReturnType<typeof agenticRunStateEmitter> {
    if (cachedEmitter === undefined) {
        cachedEmitter = agenticRunStateEmitter({ log })
    }
    return cachedEmitter
}

let cachedEmitter: ReturnType<typeof agenticRunStateEmitter> | undefined
