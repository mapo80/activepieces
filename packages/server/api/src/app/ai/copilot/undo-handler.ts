import {
    AppliedInverse,
    FlowOperationRequest,
    FlowOperationType,
    FlowVersion,
    isNil,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../../flows/flow/flow.service'
import { flowVersionService } from '../../flows/flow-version/flow-version.service'
import { CopilotSession, copilotSessionStore } from './session-store'

type UndoMode = 'copilot-only' | 'reset-to-snapshot'

async function undoCopilotOnly(params: {
    session: CopilotSession
    log: FastifyBaseLogger
}): Promise<FlowVersion> {
    const { session, log } = params
    let current = await flowVersionService(log).getOneOrThrow(session.flowVersionId)
    const inverses = [...session.appliedOps].reverse()
    for (const entry of inverses) {
        const inv: AppliedInverse = entry.inverse
        if (inv.kind === 'flow-operation') {
            current = await flowVersionService(log).applyOperation({
                flowVersion: current,
                userId: session.userId,
                projectId: session.projectId,
                platformId: session.platformId,
                userOperation: inv.op as FlowOperationRequest,
            })
        }
        else if (inv.kind === 'flow-delete') {
            await flowService(log).delete({
                id: inv.flowId,
                projectId: inv.projectId,
            })
        }
    }
    copilotSessionStore.update(session.id, {
        appliedOps: [],
        flowVersionId: current.id,
        lastKnownUpdated: current.updated,
    })
    return current
}

async function resetToSnapshot(params: {
    session: CopilotSession
    log: FastifyBaseLogger
}): Promise<FlowVersion> {
    const { session, log } = params
    let current = await flowVersionService(log).getOneOrThrow(session.flowVersionId)
    if (isNil(session.snapshotFlowVersion)) {
        throw new Error('snapshot-missing')
    }
    const op: FlowOperationRequest = {
        type: FlowOperationType.UPDATE_TRIGGER,
        request: session.snapshotFlowVersion.trigger,
    } as FlowOperationRequest
    current = await flowVersionService(log).applyOperation({
        flowVersion: current,
        userId: session.userId,
        projectId: session.projectId,
        platformId: session.platformId,
        userOperation: op,
    })
    copilotSessionStore.update(session.id, {
        appliedOps: [],
        flowVersionId: current.id,
        lastKnownUpdated: current.updated,
    })
    return current
}

async function undo(params: {
    session: CopilotSession
    mode: UndoMode
    log: FastifyBaseLogger
}): Promise<FlowVersion> {
    const { session, mode, log } = params
    if (mode === 'copilot-only') return undoCopilotOnly({ session, log })
    return resetToSnapshot({ session, log })
}

export const copilotUndoHandler = {
    undo,
}
