import { stepCountIs, streamText, tool, ToolSet } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { nanoid } from 'nanoid'
import {
    AIProviderName,
    AppliedInverse,
    CopilotEvent,
    CopilotScope,
    FlowOperationRequest,
    FlowVersion,
    flowStructureUtil,
    FlowActionType,
    InteractiveFlowAction,
    isNil,
} from '@activepieces/shared'
import { CopilotContext, copilotScopeRegistry, CopilotTool } from './scope-registry'
import { CopilotSession, copilotSessionStore } from './session-store'
import { copilotInverseOp } from './inverse-op'
import { interactiveFlowModelFactory } from '../interactive-flow-model-factory'
import { flowVersionService } from '../../flows/flow-version/flow-version.service'
import { flowService } from '../../flows/flow/flow.service'
import { validateInteractiveFlow } from '../../flows/flow-version/interactive-flow-validator'

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const TIMEOUT_MS = 60_000

function computeMaxSteps(toolsCount: number): number {
    return Math.max(20, toolsCount * 2)
}

function resolveTemperature(): number {
    const envTemp = process.env.COPILOT_TEST_TEMPERATURE
    if (envTemp) {
        const parsed = Number.parseFloat(envTemp)
        if (!Number.isNaN(parsed)) return parsed
    }
    return 0.3
}

async function reloadFlowVersion(flowVersionId: string): Promise<FlowVersion> {
    const loaded = await flowVersionService(undefined as unknown as FastifyBaseLogger).getOneOrThrow(flowVersionId)
    return loaded
}

async function dryRunValidate(params: {
    draft: FlowVersion
    scope: CopilotScope
}): Promise<{ valid: boolean, errors?: Array<{ field?: string, message: string }> }> {
    const { draft, scope } = params
    if (scope !== 'INTERACTIVE_FLOW' && scope !== 'EMPTY_OR_NEW') {
        return { valid: true }
    }
    const steps = flowStructureUtil.getAllSteps(draft.trigger)
    const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
    if (isNil(ifStep)) return { valid: true }
    return validateInteractiveFlow(ifStep.settings)
}

async function applyOperationAndBuildInverse(params: {
    session: CopilotSession
    op: FlowOperationRequest
    log: FastifyBaseLogger
}): Promise<{ newFlowVersion: FlowVersion, inverse: AppliedInverse }> {
    const { session, op, log } = params
    const currentFV = await reloadFlowVersion(session.flowVersionId)
    if (currentFV.updated !== session.lastKnownUpdated) {
        throw new Error('flow-modified-elsewhere')
    }
    const inverse = copilotInverseOp.computeInverse({ op, beforeFlowVersion: currentFV })
    const newFV = await flowVersionService(log).applyOperation({
        flowVersion: currentFV,
        userId: session.userId,
        projectId: session.projectId,
        platformId: session.platformId,
        userOperation: op,
    })
    return { newFlowVersion: newFV, inverse }
}

async function* runCopilotLoop(params: {
    session: CopilotSession
    userMessage: string
    log: FastifyBaseLogger
    abortSignal: AbortSignal
}): AsyncGenerator<CopilotEvent> {
    const { session, userMessage, log, abortSignal } = params
    const startedAt = Date.now()
    const contract = copilotScopeRegistry.getContract(session.scope)
    if (!contract) {
        yield { type: 'error', message: `scope "${session.scope}" has no contract registered` }
        yield { type: 'done', tokensUsed: 0, durationMs: Date.now() - startedAt }
        return
    }

    let model
    try {
        model = await interactiveFlowModelFactory.build({
            platformId: session.platformId,
            provider: AIProviderName.ANTHROPIC,
            modelId: DEFAULT_MODEL,
            log,
        })
    }
    catch (err) {
        yield { type: 'error', message: `model-init-failed: ${(err as Error).message}` }
        yield { type: 'done', tokensUsed: 0, durationMs: Date.now() - startedAt }
        return
    }

    const toolEvents: CopilotEvent[] = []
    const pendingOpsByCallId: Map<string, FlowOperationRequest> = new Map()
    let currentFlowVersion = await reloadFlowVersion(session.flowVersionId)

    function buildAiToolset(): ToolSet {
        const set: ToolSet = {}
        for (const [name, def] of Object.entries(contract!.tools)) {
            const toolDef = def as CopilotTool
            set[name] = tool({
                description: toolDef.description,
                inputSchema: toolDef.parameters,
                execute: async (args: unknown, opts: { toolCallId: string }) => {
                    const callId = opts.toolCallId
                    toolEvents.push({ type: 'tool-call-start', toolCallId: callId, name, args })
                    try {
                        const ctx: CopilotContext = {
                            flowVersion: currentFlowVersion,
                            appliedOps: session.appliedOps,
                            scope: session.scope,
                            userId: session.userId,
                            projectId: session.projectId,
                            platformId: session.platformId,
                            gatewayId: extractGatewayId(currentFlowVersion),
                        }
                        const result = await toolDef.execute(args, ctx)
                        const maybeOp = (result as { op?: FlowOperationRequest }).op
                        const createdFlow = result as { _createdFlow?: boolean, flowId?: string, flowVersionId?: string }
                        if (createdFlow._createdFlow && createdFlow.flowId && createdFlow.flowVersionId) {
                            copilotSessionStore.update(session.id, { flowId: createdFlow.flowId, flowVersionId: createdFlow.flowVersionId })
                            currentFlowVersion = await reloadFlowVersion(createdFlow.flowVersionId)
                            toolEvents.push({
                                type: 'flow-created',
                                toolCallId: callId,
                                flowId: createdFlow.flowId,
                                flowVersionId: createdFlow.flowVersionId,
                                inverse: { kind: 'flow-delete', flowId: createdFlow.flowId, projectId: session.projectId },
                            })
                            toolEvents.push({ type: 'tool-call-end', toolCallId: callId, result })
                            return result
                        }
                        if (maybeOp) {
                            pendingOpsByCallId.set(callId, maybeOp)
                            const dryRunVersion = { ...currentFlowVersion }
                            const validation = await dryRunValidate({ draft: dryRunVersion, scope: session.scope })
                            if (!validation.valid) {
                                toolEvents.push({ type: 'tool-call-end', toolCallId: callId, error: `validation: ${JSON.stringify(validation.errors)}` })
                                return { ok: false, validation }
                            }
                            const { newFlowVersion, inverse } = await applyOperationAndBuildInverse({ session, op: maybeOp, log })
                            currentFlowVersion = newFlowVersion
                            session.appliedOps.push({ op: maybeOp, inverse })
                            copilotSessionStore.update(session.id, {
                                flowVersionId: newFlowVersion.id,
                                lastKnownUpdated: newFlowVersion.updated,
                                appliedOps: session.appliedOps,
                            })
                            toolEvents.push({
                                type: 'flow-updated',
                                toolCallId: callId,
                                flowVersion: newFlowVersion,
                                inverse,
                            })
                            toolEvents.push({ type: 'tool-call-end', toolCallId: callId, result: { applied: true } })
                            return { applied: true }
                        }
                        toolEvents.push({ type: 'tool-call-end', toolCallId: callId, result })
                        return result
                    }
                    catch (err) {
                        toolEvents.push({ type: 'tool-call-end', toolCallId: callId, error: (err as Error).message })
                        return { ok: false, error: (err as Error).message }
                    }
                },
            })
        }
        return set
    }

    const aiTools = buildAiToolset()
    const historyMessages = session.history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }))
    const messages = [
        ...historyMessages,
        { role: 'user' as const, content: userMessage },
    ]

    let tokensUsed = 0
    let finalized = false
    let finalizeSummary = ''
    let finalizeQuestions: string[] = []

    try {
        const result = streamText({
            model,
            system: contract.systemPrompt,
            messages,
            tools: aiTools,
            stopWhen: stepCountIs(computeMaxSteps(Object.keys(contract.tools).length)),
            temperature: resolveTemperature(),
            abortSignal,
        })
        for await (const part of result.fullStream) {
            if (abortSignal.aborted) break
            while (toolEvents.length > 0) {
                const ev = toolEvents.shift()
                if (ev) yield ev
            }
            if (part.type === 'text-delta') {
                yield { type: 'text-delta', delta: part.text }
            }
            else if (part.type === 'finish') {
                tokensUsed = part.totalUsage?.totalTokens ?? 0
            }
        }
        while (toolEvents.length > 0) {
            const ev = toolEvents.shift()
            if (ev) yield ev
        }
        const finalizeCall = session.appliedOps.length > 0 ? session.appliedOps.length : 0
        const finalizeResult = pendingOpsByCallId
        if (finalizeResult) finalized = true

        yield {
            type: 'summary',
            scope: session.scope,
            text: finalizeSummary || `Applied ${finalizeCall} operation(s).`,
            appliedCount: finalizeCall,
            questions: finalizeQuestions,
        }
    }
    catch (err) {
        yield { type: 'error', message: (err as Error).message }
    }

    session.history.push({ role: 'user', content: userMessage })
    if (finalized) session.history.push({ role: 'assistant', content: finalizeSummary })
    copilotSessionStore.update(session.id, { history: session.history })

    yield { type: 'done', tokensUsed, durationMs: Date.now() - startedAt }
}

function extractGatewayId(flowVersion: FlowVersion): string | undefined {
    const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
    const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
    return ifStep?.settings.mcpGatewayId
}

export const copilotService = {
    runCopilotLoop,
    TIMEOUT_MS,
    DEFAULT_MODEL,
}
