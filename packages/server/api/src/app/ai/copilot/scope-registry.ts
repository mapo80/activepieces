import { CopilotScope, FlowOperationRequest, FlowVersion } from '@activepieces/shared'
import { Tool } from 'ai'
import { z } from 'zod'

export type ValidationResult = {
    valid: boolean
    errors?: Array<{ field?: string, message: string }>
}

export type CopilotContext = {
    flowVersion: FlowVersion
    appliedOps: Array<{ op: FlowOperationRequest, inverse: unknown }>
    scope: CopilotScope
    userId: string
    projectId: string
    platformId: string
    gatewayId?: string
}

export type CopilotTool = {
    description: string
    parameters: z.ZodSchema
    isMutation: boolean
    execute: (args: unknown, ctx: CopilotContext) => Promise<unknown>
}

export type ScopeContract = {
    scope: CopilotScope
    detect: (flowVersion: FlowVersion, selectedStepName?: string) => boolean
    validator: (draftVersion: FlowVersion) => ValidationResult
    systemPrompt: string
    tools: Record<string, CopilotTool>
}

const registry: Map<CopilotScope, ScopeContract> = new Map()

function register(contract: ScopeContract): void {
    registry.set(contract.scope, contract)
}

function getContract(scope: CopilotScope): ScopeContract | undefined {
    return registry.get(scope)
}

function listScopes(): CopilotScope[] {
    return Array.from(registry.keys())
}

export const copilotScopeRegistry = {
    register,
    getContract,
    listScopes,
}

export type AiTool = Tool
