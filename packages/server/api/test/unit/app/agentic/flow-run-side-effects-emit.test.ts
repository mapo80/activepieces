import { FlowRun, FlowRunStatus, RunEnvironment } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const emitMock = vi.fn()

vi.mock('../../../../src/app/agentic/agentic-run-state-emitter', () => ({
    agenticRunStateEmitter: () => ({
        emit: emitMock,
    }),
}))

vi.mock('../../../../src/app/flows/flow-run/flow-run-hooks', () => ({
    flowRunHooks: () => ({
        onFinish: vi.fn().mockResolvedValue(undefined),
    }),
}))

vi.mock('../../../../src/app/flows/flow-run/waitpoint/waitpoint-service', () => ({
    waitpointService: () => ({
        deleteByFlowRunId: vi.fn().mockResolvedValue(undefined),
    }),
}))

vi.mock('../../../../src/app/helper/application-events', () => ({
    applicationEvents: () => ({
        sendWorkerEvent: vi.fn(),
    }),
}))

import { flowRunSideEffects } from '../../../../src/app/flows/flow-run/flow-run-side-effects'

function buildLogger(): { info: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn>, debug: ReturnType<typeof vi.fn> } {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function buildFlowRun(overrides: Partial<FlowRun> = {}): FlowRun {
    const base: FlowRun = {
        id: 'ap-run-1',
        flowVersionId: 'flowver-12345',
        flowId: 'flow-1',
        projectId: 'proj-1',
        environment: RunEnvironment.PRODUCTION,
        status: FlowRunStatus.SUCCEEDED,
        flowDisplayName: 'Test Flow',
        startTime: '2026-05-02T10:00:00.000Z',
        finishTime: '2026-05-02T10:00:01.000Z',
        tasks: 5,
        created: '2026-05-02T10:00:00.000Z',
        updated: '2026-05-02T10:00:01.000Z',
    } as FlowRun
    return { ...base, ...overrides }
}

describe('flowRunSideEffects agentic emission', () => {
    beforeEach(() => {
        emitMock.mockReset()
        emitMock.mockResolvedValue({ delivered: true, status: 202 })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('emits SUCCEEDED state when run finishes successfully', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({ status: FlowRunStatus.SUCCEEDED }))

        expect(emitMock).toHaveBeenCalledTimes(1)
        const call = emitMock.mock.calls[0][0]
        expect(call.runState).toBe('SUCCEEDED')
        expect(call.platformRunId).toBe('ap-run-1')
        expect(call.externalRunId).toBe('ap-run-1')
        expect(call.projectId).toBe('proj-1')
    })

    it('emits FAILED state when run fails (FAILED status)', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({ status: FlowRunStatus.FAILED }))

        expect(emitMock.mock.calls[0][0].runState).toBe('FAILED')
    })

    it('emits FAILED state for INTERNAL_ERROR + QUOTA_EXCEEDED + TIMEOUT', async () => {
        const log = buildLogger()
        for (const status of [FlowRunStatus.INTERNAL_ERROR, FlowRunStatus.QUOTA_EXCEEDED, FlowRunStatus.TIMEOUT]) {
            emitMock.mockClear()
            await flowRunSideEffects(log as never).onFinish(buildFlowRun({ status }))
            if (status === FlowRunStatus.INTERNAL_ERROR) {
                continue
            }
            expect(emitMock.mock.calls[0][0].runState).toBe('FAILED')
        }
    })

    it('emits CANCELED state when run is canceled', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({ status: FlowRunStatus.CANCELED }))

        expect(emitMock.mock.calls[0][0].runState).toBe('CANCELED')
    })

    it('emits PAUSED state on onPause when status is PAUSED', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onPause(buildFlowRun({ status: FlowRunStatus.PAUSED }))

        expect(emitMock).toHaveBeenCalledTimes(1)
        expect(emitMock.mock.calls[0][0].runState).toBe('PAUSED')
    })

    it('does NOT emit on onPause when status is not PAUSED', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onPause(buildFlowRun({ status: FlowRunStatus.RUNNING }))

        expect(emitMock).not.toHaveBeenCalled()
    })

    it('does NOT emit on onFinish when status is non-terminal', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({ status: FlowRunStatus.RUNNING }))

        expect(emitMock).not.toHaveBeenCalled()
    })

    it('best-effort: emit error does not throw upstream', async () => {
        emitMock.mockRejectedValueOnce(new Error('network down'))
        const log = buildLogger()

        await expect(flowRunSideEffects(log as never).onFinish(buildFlowRun({ status: FlowRunStatus.SUCCEEDED })))
            .resolves.not.toThrow()
        expect(log.warn).toHaveBeenCalled()
    })

    it('payload includes eventEpoch from updated timestamp', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({
            status: FlowRunStatus.SUCCEEDED,
            updated: '2026-05-02T10:00:01.000Z',
        }))

        const call = emitMock.mock.calls[0][0]
        expect(call.eventEpoch).toBe(new Date('2026-05-02T10:00:01.000Z').getTime())
        expect(call.runVersion).toBe(call.eventEpoch)
    })

    it('uses a canonical platformRunId when the flowRun carries agentic metadata', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({
            status: FlowRunStatus.SUCCEEDED,
            metadata: { platformRunId: 'plat-r-9', providerEpoch: 7 },
        } as Partial<FlowRun>))

        const call = emitMock.mock.calls[0][0]
        expect(call.platformRunId).toBe('plat-r-9')
        expect(call.externalRunId).toBe('ap-run-1')
        expect(call.providerEpoch).toBe(7)
        expect(call.runVersion).toBe(7)
    })

    it('emits increasing versions for pause and terminal callbacks of the same AP run', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onPause(buildFlowRun({
            status: FlowRunStatus.PAUSED,
            updated: '2026-05-02T10:00:01.000Z',
        }))
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({
            status: FlowRunStatus.SUCCEEDED,
            updated: '2026-05-02T10:00:02.000Z',
        }))

        const paused = emitMock.mock.calls[0][0]
        const succeeded = emitMock.mock.calls[1][0]
        expect(paused.platformRunId).toBe(succeeded.platformRunId)
        expect(paused.externalRunId).toBe(succeeded.externalRunId)
        expect(succeeded.runVersion).toBeGreaterThan(paused.runVersion)
    })

    it('payload includes data with failedStepName when run failed with step info', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({
            status: FlowRunStatus.FAILED,
            failedStep: { name: 'submit_application' },
        } as Partial<FlowRun>))

        const call = emitMock.mock.calls[0][0]
        expect(call.data?.failedStepName).toBe('submit_application')
    })

    it('payload preserves projectId for tenant scoping', async () => {
        const log = buildLogger()
        await flowRunSideEffects(log as never).onFinish(buildFlowRun({
            status: FlowRunStatus.SUCCEEDED,
            projectId: 'proj-tenant-bank',
        }))

        expect(emitMock.mock.calls[0][0].projectId).toBe('proj-tenant-bank')
    })
})
