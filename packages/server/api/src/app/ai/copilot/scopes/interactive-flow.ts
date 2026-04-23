import * as fs from 'fs'
import * as path from 'path'
import { FlowActionType, flowStructureUtil, InteractiveFlowAction, isNil } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { validateInteractiveFlow } from '../../../flows/flow-version/interactive-flow-validator'
import { copilotScopeRegistry, ScopeContract, ValidationResult } from '../scope-registry'
import { addNodeTool } from '../tools/interactive-flow/add-node'
import { addStateFieldTool } from '../tools/interactive-flow/add-state-field'
import { finalizeTool } from '../tools/interactive-flow/finalize'
import { buildListMcpToolsTool } from '../tools/interactive-flow/list-mcp-tools'
import { readFlowSettingsTool } from '../tools/interactive-flow/read-flow-settings'
import { scaffoldSettingsTool } from '../tools/interactive-flow/scaffold-settings'
import { setMessageInputTool } from '../tools/interactive-flow/set-message-input'
import { setSystemPromptTool } from '../tools/interactive-flow/set-system-prompt'
import { updateNodeTool } from '../tools/interactive-flow/update-node'
import { updateStateFieldTool } from '../tools/interactive-flow/update-state-field'
import { validatePatchTool } from '../tools/interactive-flow/validate-patch'

const SYSTEM_PROMPT = fs.readFileSync(
    path.join(__dirname, '../prompts/interactive-flow.md'),
    'utf8',
)

export function registerInteractiveFlowScope(log: FastifyBaseLogger): void {
    const contract: ScopeContract = {
        scope: 'INTERACTIVE_FLOW',
        detect: (flowVersion, selectedStepName) => {
            const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
            if (selectedStepName) {
                const s = flowStructureUtil.getStep(selectedStepName, flowVersion.trigger)
                return s?.type === FlowActionType.INTERACTIVE_FLOW
            }
            return steps.some((s) => s.type === FlowActionType.INTERACTIVE_FLOW)
        },
        validator: (flowVersion): ValidationResult => {
            const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
            const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
            if (isNil(ifStep)) return { valid: false, errors: [{ message: 'No INTERACTIVE_FLOW action present.' }] }
            return validateInteractiveFlow(ifStep.settings)
        },
        systemPrompt: SYSTEM_PROMPT,
        tools: {
            read_flow_settings: readFlowSettingsTool,
            scaffold_interactive_flow_settings: scaffoldSettingsTool,
            add_state_field: addStateFieldTool,
            update_state_field: updateStateFieldTool,
            set_system_prompt: setSystemPromptTool,
            set_message_input: setMessageInputTool,
            add_node: addNodeTool,
            update_node: updateNodeTool,
            validate_patch: validatePatchTool,
            list_mcp_tools: buildListMcpToolsTool(log),
            finalize: finalizeTool,
        },
    }
    copilotScopeRegistry.register(contract)
}
