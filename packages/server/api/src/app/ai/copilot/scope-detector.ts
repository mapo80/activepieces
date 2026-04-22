import { CopilotScope, FlowActionType, FlowVersion, flowStructureUtil } from '@activepieces/shared'

function detectScope(params: {
    flowVersion: FlowVersion
    selectedStepName?: string
}): CopilotScope | null {
    const { flowVersion, selectedStepName } = params
    if (selectedStepName) {
        const selected = flowStructureUtil.getStep(selectedStepName, flowVersion.trigger)
        if (selected?.type === FlowActionType.INTERACTIVE_FLOW) {
            return 'INTERACTIVE_FLOW'
        }
    }
    const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
    const hasInteractiveFlow = steps.some((s) => s.type === FlowActionType.INTERACTIVE_FLOW)
    if (hasInteractiveFlow) return 'INTERACTIVE_FLOW'
    const hasOnlyTrigger = steps.length === 1
    if (hasOnlyTrigger) return 'EMPTY_OR_NEW'
    return null
}

export const copilotScopeDetector = {
    detectScope,
}
