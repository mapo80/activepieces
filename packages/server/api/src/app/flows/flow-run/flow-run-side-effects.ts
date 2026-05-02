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
    const result = await tryCatch(() => emitter.emit({
        platformRunId: flowRun.id,
        runVersion: deriveRunVersion(flowRun),
        runState,
        eventEpoch: deriveEventEpoch(flowRun),
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

function deriveRunVersion(flowRun: FlowRun): number {
    return Number(flowRun.flowVersionId.replace(/[^0-9]/g, '').slice(-9)) || 1
}

function deriveEventEpoch(flowRun: FlowRun): number {
    const updated = flowRun.updated ?? new Date().toISOString()
    return new Date(updated).getTime()
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
