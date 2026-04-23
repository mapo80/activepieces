import * as fs from 'fs'
import * as path from 'path'
import { FlowActionType, flowStructureUtil, InteractiveFlowAction, isNil } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { validateInteractiveFlow } from '../../../flows/flow-version/interactive-flow-validator'
import { copilotScopeRegistry, ScopeContract, ValidationResult } from '../scope-registry'
import { buildCreateNewFlowTool } from '../tools/empty-or-new/create-new-flow'
import { insertInteractiveFlowActionTool } from '../tools/empty-or-new/insert-interactive-flow-action'
import { addNodeTool } from '../tools/interactive-flow/add-node'
import { addStateFieldTool } from '../tools/interactive-flow/add-state-field'
import { finalizeTool } from '../tools/interactive-flow/finalize'
import { buildListMcpGatewaysTool } from '../tools/interactive-flow/list-mcp-gateways'
import { buildListMcpToolsTool } from '../tools/interactive-flow/list-mcp-tools'
import { readFlowSettingsTool } from '../tools/interactive-flow/read-flow-settings'
import { scaffoldSettingsTool } from '../tools/interactive-flow/scaffold-settings'
import { setMessageInputTool } from '../tools/interactive-flow/set-message-input'
import { setSystemPromptTool } from '../tools/interactive-flow/set-system-prompt'
import { updateNodeTool } from '../tools/interactive-flow/update-node'
import { updateStateFieldTool } from '../tools/interactive-flow/update-state-field'
import { validatePatchTool } from '../tools/interactive-flow/validate-patch'

const SYSTEM_PROMPT = fs.readFileSync(
    path.join(__dirname, '../prompts/empty-or-new.md'),
    'utf8',
)

export function registerEmptyOrNewScope(log: FastifyBaseLogger): void {
    const contract: ScopeContract = {
        scope: 'EMPTY_OR_NEW',
        detect: (flowVersion) => {
            const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
            return steps.length === 1 // trigger only
        },
        validator: (flowVersion): ValidationResult => {
            const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
            const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
            if (isNil(ifStep)) return { valid: true } // still being built
            return validateInteractiveFlow(ifStep.settings)
        },
        systemPrompt: SYSTEM_PROMPT,
        tools: {
            read_flow_settings: readFlowSettingsTool,
            create_new_flow: buildCreateNewFlowTool(log),
            insert_interactive_flow_action: insertInteractiveFlowActionTool,
            scaffold_interactive_flow_settings: scaffoldSettingsTool,
            list_mcp_gateways: buildListMcpGatewaysTool(log),
            list_mcp_tools: buildListMcpToolsTool(log),
            add_state_field: addStateFieldTool,
            update_state_field: updateStateFieldTool,
            add_node: addNodeTool,
            update_node: updateNodeTool,
            set_system_prompt: setSystemPromptTool,
            set_message_input: setMessageInputTool,
            validate_patch: validatePatchTool,
            finalize: finalizeTool,
        },
    }
    copilotScopeRegistry.register(contract)
}
