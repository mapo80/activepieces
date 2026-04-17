import { FlowActionType, InteractiveFlowAction } from '../actions/action'
import { FlowVersion } from '../flow-version'
import { flowStructureUtil } from '../util/flow-structure-util'

function _deleteInteractiveFlowNode(flowVersion: FlowVersion, request: { stepName: string, nodeId: string }): FlowVersion {
    return flowStructureUtil.transferFlow(flowVersion, (parentStep) => {
        if (parentStep.name !== request.stepName || parentStep.type !== FlowActionType.INTERACTIVE_FLOW) {
            return parentStep
        }
        const interactiveFlowAction = parentStep as InteractiveFlowAction
        return {
            ...interactiveFlowAction,
            settings: {
                ...interactiveFlowAction.settings,
                nodes: interactiveFlowAction.settings.nodes.filter(node => node.id !== request.nodeId),
            },
        }
    })
}

export { _deleteInteractiveFlowNode }
