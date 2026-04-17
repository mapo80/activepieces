import { FlowActionType, InteractiveFlowAction } from '../../../src/lib/automation/flows/actions/action'
import { InteractiveFlowNodeType } from '../../../src/lib/automation/flows/actions/interactive-flow-action'
import { FlowVersion, FlowVersionState } from '../../../src/lib/automation/flows/flow-version'
import { FlowTriggerType } from '../../../src/lib/automation/flows/triggers/trigger'
import { flowOperations, FlowOperationType } from '../../../src/lib/automation/flows/operations'
import { flowStructureUtil } from '../../../src/lib/automation/flows/util/flow-structure-util'

const sampleNode = {
    id: 'node_1',
    name: 'search_customer',
    displayName: 'Search Customer',
    nodeType: InteractiveFlowNodeType.TOOL,
    stateInputs: ['clientName'],
    stateOutputs: ['searchResults'],
    tool: 'banking/search_customer',
}

const sampleNode2 = {
    id: 'node_2',
    name: 'collect_name',
    displayName: 'Collect Name',
    nodeType: InteractiveFlowNodeType.USER_INPUT,
    stateInputs: [],
    stateOutputs: ['clientName'],
    render: { component: 'TextInput', props: {} },
}

function createFlowVersionWithInteractiveFlow(nodes: typeof sampleNode[]): FlowVersion {
    const interactiveFlowAction: InteractiveFlowAction = {
        name: 'interactive_step',
        displayName: 'Interactive Flow',
        type: FlowActionType.INTERACTIVE_FLOW,
        valid: true,
        lastUpdatedDate: new Date().toISOString(),
        settings: {
            nodes,
            stateFields: [
                { name: 'clientName', type: 'string' },
                { name: 'searchResults', type: 'array' },
            ],
        },
    }

    return {
        id: 'version_1',
        flowId: 'flow_1',
        displayName: 'Test Flow',
        state: FlowVersionState.DRAFT,
        valid: true,
        updatedBy: null,
        schemaVersion: '21',
        agentIds: [],
        connectionIds: [],
        backupFiles: null,
        notes: [],
        trigger: {
            name: 'trigger',
            displayName: 'Trigger',
            type: FlowTriggerType.EMPTY,
            valid: true,
            settings: {},
            nextAction: interactiveFlowAction,
        },
    }
}

describe('FlowOperations - ADD_INTERACTIVE_FLOW_NODE', () => {

    it('should add node to settings.nodes', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])

        const result = flowOperations.apply(flowVersion, {
            type: FlowOperationType.ADD_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'interactive_step',
                node: sampleNode2,
            },
        })

        const step = flowStructureUtil.getStep('interactive_step', result.trigger) as InteractiveFlowAction
        expect(step.settings.nodes).toHaveLength(2)
        expect(step.settings.nodes[1].id).toBe('node_2')
    })

    it('should not modify the original flow version (immutability)', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])
        const originalNodeCount = (flowStructureUtil.getStep('interactive_step', flowVersion.trigger) as InteractiveFlowAction).settings.nodes.length

        flowOperations.apply(flowVersion, {
            type: FlowOperationType.ADD_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'interactive_step',
                node: sampleNode2,
            },
        })

        const stepAfter = flowStructureUtil.getStep('interactive_step', flowVersion.trigger) as InteractiveFlowAction
        expect(stepAfter.settings.nodes).toHaveLength(originalNodeCount)
    })

    it('should not change flow when step name does not match', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])

        const result = flowOperations.apply(flowVersion, {
            type: FlowOperationType.ADD_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'nonexistent_step',
                node: sampleNode2,
            },
        })

        const step = flowStructureUtil.getStep('interactive_step', result.trigger) as InteractiveFlowAction
        expect(step.settings.nodes).toHaveLength(1)
    })
})

describe('FlowOperations - UPDATE_INTERACTIVE_FLOW_NODE', () => {

    it('should update existing node by id', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode, sampleNode2])

        const updatedNode = { ...sampleNode, displayName: 'Updated Search' }
        const result = flowOperations.apply(flowVersion, {
            type: FlowOperationType.UPDATE_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'interactive_step',
                node: updatedNode,
            },
        })

        const step = flowStructureUtil.getStep('interactive_step', result.trigger) as InteractiveFlowAction
        expect(step.settings.nodes).toHaveLength(2)
        expect(step.settings.nodes[0].displayName).toBe('Updated Search')
        expect(step.settings.nodes[1].id).toBe('node_2')
    })

    it('should not change flow when node id does not exist', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])

        const nonExistentNode = { ...sampleNode, id: 'nonexistent_id', displayName: 'Ghost' }
        const result = flowOperations.apply(flowVersion, {
            type: FlowOperationType.UPDATE_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'interactive_step',
                node: nonExistentNode,
            },
        })

        const step = flowStructureUtil.getStep('interactive_step', result.trigger) as InteractiveFlowAction
        expect(step.settings.nodes).toHaveLength(1)
        expect(step.settings.nodes[0].displayName).toBe('Search Customer')
    })
})

describe('FlowOperations - DELETE_INTERACTIVE_FLOW_NODE', () => {

    it('should remove node by id', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode, sampleNode2])

        const result = flowOperations.apply(flowVersion, {
            type: FlowOperationType.DELETE_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'interactive_step',
                nodeId: 'node_1',
            },
        })

        const step = flowStructureUtil.getStep('interactive_step', result.trigger) as InteractiveFlowAction
        expect(step.settings.nodes).toHaveLength(1)
        expect(step.settings.nodes[0].id).toBe('node_2')
    })

    it('should not change flow when node id does not exist', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])

        const result = flowOperations.apply(flowVersion, {
            type: FlowOperationType.DELETE_INTERACTIVE_FLOW_NODE,
            request: {
                stepName: 'interactive_step',
                nodeId: 'nonexistent_id',
            },
        })

        const step = flowStructureUtil.getStep('interactive_step', result.trigger) as InteractiveFlowAction
        expect(step.settings.nodes).toHaveLength(1)
    })
})

describe('flowStructureUtil with INTERACTIVE_FLOW', () => {

    it('should include INTERACTIVE_FLOW action in getAllSteps result', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])
        const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)

        const interactiveStep = steps.find(s => s.name === 'interactive_step')
        expect(interactiveStep).toBeDefined()
        expect(interactiveStep?.type).toBe(FlowActionType.INTERACTIVE_FLOW)
    })

    it('should continue to nextAction after INTERACTIVE_FLOW', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])
        const interactiveStep = flowStructureUtil.getStep('interactive_step', flowVersion.trigger) as InteractiveFlowAction
        interactiveStep.nextAction = {
            name: 'code_step',
            displayName: 'Code Step',
            type: FlowActionType.CODE,
            valid: true,
            lastUpdatedDate: new Date().toISOString(),
            settings: {
                sourceCode: { packageJson: '', code: '' },
                input: {},
            },
        }

        const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
        const codeStep = steps.find(s => s.name === 'code_step')
        expect(codeStep).toBeDefined()
    })

    it('should visit INTERACTIVE_FLOW action during transferFlow', () => {
        const flowVersion = createFlowVersionWithInteractiveFlow([sampleNode])
        const visited: string[] = []

        flowStructureUtil.transferFlow(flowVersion, (step) => {
            visited.push(step.name)
            return step
        })

        expect(visited).toContain('interactive_step')
    })
})
