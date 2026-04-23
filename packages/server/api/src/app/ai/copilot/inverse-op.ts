import {
    AppliedInverse,
    FlowOperationRequest,
    FlowOperationType,
    flowStructureUtil,
    FlowVersion,
    isNil,
} from '@activepieces/shared'

function computeInverse(params: {
    op: FlowOperationRequest
    beforeFlowVersion: FlowVersion
}): AppliedInverse {
    const { op, beforeFlowVersion } = params
    switch (op.type) {
        case FlowOperationType.UPDATE_ACTION: {
            const stepName = op.request.name
            const before = flowStructureUtil.getStep(stepName, beforeFlowVersion.trigger)
            if (isNil(before)) {
                throw new Error(`inverse: step "${stepName}" not found in pre-state`)
            }
            return {
                kind: 'flow-operation',
                op: {
                    type: FlowOperationType.UPDATE_ACTION,
                    request: before as typeof op.request,
                },
            }
        }
        case FlowOperationType.UPDATE_TRIGGER: {
            return {
                kind: 'flow-operation',
                op: {
                    type: FlowOperationType.UPDATE_TRIGGER,
                    request: beforeFlowVersion.trigger,
                },
            }
        }
        case FlowOperationType.ADD_ACTION: {
            return {
                kind: 'flow-operation',
                op: {
                    type: FlowOperationType.DELETE_ACTION,
                    request: {
                        names: [op.request.action.name],
                    },
                },
            }
        }
        default:
            throw new Error(`inverse: unsupported op type ${op.type}`)
    }
}

export const copilotInverseOp = {
    computeInverse,
}
