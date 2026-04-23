import { AppliedInverse, CopilotScope, FlowOperationRequest, FlowVersion } from '@activepieces/shared'
import { nanoid } from 'nanoid'

type SessionHistoryEntry = {
    role: 'user' | 'assistant'
    content: string
}

export type CopilotSession = {
    id: string
    userId: string
    projectId: string
    platformId: string
    flowId: string
    flowVersionId: string
    lastKnownUpdated: string
    scope: CopilotScope
    history: SessionHistoryEntry[]
    appliedOps: Array<{ op: FlowOperationRequest, inverse: AppliedInverse }>
    snapshotFlowVersion: FlowVersion
    createdAt: string
    lastTurnAt: string
}

const sessions = new Map<string, CopilotSession>()

function create(params: {
    userId: string
    projectId: string
    platformId: string
    flowId: string
    flowVersion: FlowVersion
    scope: CopilotScope
}): CopilotSession {
    const now = new Date().toISOString()
    const session: CopilotSession = {
        id: nanoid(),
        userId: params.userId,
        projectId: params.projectId,
        platformId: params.platformId,
        flowId: params.flowId,
        flowVersionId: params.flowVersion.id,
        lastKnownUpdated: params.flowVersion.updated,
        scope: params.scope,
        history: [],
        appliedOps: [],
        snapshotFlowVersion: params.flowVersion,
        createdAt: now,
        lastTurnAt: now,
    }
    sessions.set(session.id, session)
    return session
}

function get(id: string): CopilotSession | undefined {
    return sessions.get(id)
}

function update(id: string, patch: Partial<CopilotSession>): CopilotSession | undefined {
    const existing = sessions.get(id)
    if (!existing) return undefined
    const updated = { ...existing, ...patch, lastTurnAt: new Date().toISOString() }
    sessions.set(id, updated)
    return updated
}

function del(id: string): boolean {
    return sessions.delete(id)
}

function cleanupStale(maxAgeMs: number): number {
    const now = Date.now()
    let count = 0
    for (const [id, s] of sessions.entries()) {
        if (now - new Date(s.lastTurnAt).getTime() > maxAgeMs) {
            sessions.delete(id)
            count++
        }
    }
    return count
}

export const copilotSessionStore = {
    create,
    get,
    update,
    delete: del,
    cleanupStale,
}
