import { FlowActionType, InteractiveFlowAction } from '../actions/action'
import { InteractiveFlowNode } from '../actions/interactive-flow-action'
import { FlowVersion } from '../flow-version'
import { flowStructureUtil } from '../util/flow-structure-util'

function _addInteractiveFlowNode(flowVersion: FlowVersion, request: { stepName: string, node: InteractiveFlowNode }): FlowVersion {
    return flowStructureUtil.transferFlow(flowVersion, (parentStep) => {
        if (parentStep.name !== request.stepName || parentStep.type !== FlowActionType.INTERACTIVE_FLOW) {
            return parentStep
        }
        const interactiveFlowAction = parentStep as InteractiveFlowAction
        return {
            ...interactiveFlowAction,
            settings: {
                ...interactiveFlowAction.settings,
                nodes: [...interactiveFlowAction.settings.nodes, request.node],
            },
        }
    })
}

export { _addInteractiveFlowNode }
