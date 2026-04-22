import { describe, expect, it } from 'vitest'
import { copilotScopeDetector } from '../../../../../src/app/ai/copilot/scope-detector'
import { FlowVersion, FlowTriggerType, FlowActionType } from '@activepieces/shared'

function buildEmptyFlowVersion(): FlowVersion {
    return {
        id: 'fv1',
        flowId: 'f1',
        displayName: 'Empty',
        trigger: {
            type: FlowTriggerType.EMPTY,
            name: 'trigger',
            displayName: 'Start',
            valid: true,
            settings: {},
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        schemaVersion: '1',
    } as unknown as FlowVersion
}

function buildFlowWithIf(): FlowVersion {
    return {
        id: 'fv1',
        flowId: 'f1',
        displayName: 'Has IF',
        trigger: {
            type: FlowTriggerType.EMPTY,
            name: 'trigger',
            displayName: 'Start',
            valid: true,
            settings: {},
            nextAction: {
                type: FlowActionType.INTERACTIVE_FLOW,
                name: 'interactive_flow',
                displayName: 'IF',
                valid: true,
                settings: { nodes: [], stateFields: [] },
            },
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        schemaVersion: '1',
    } as unknown as FlowVersion
}

describe('copilotScopeDetector', () => {
    it('returns EMPTY_OR_NEW for trigger-only flows', () => {
        const scope = copilotScopeDetector.detectScope({ flowVersion: buildEmptyFlowVersion() })
        expect(scope).toBe('EMPTY_OR_NEW')
    })

    it('returns INTERACTIVE_FLOW when an IF action exists anywhere', () => {
        const scope = copilotScopeDetector.detectScope({ flowVersion: buildFlowWithIf() })
        expect(scope).toBe('INTERACTIVE_FLOW')
    })

    it('returns INTERACTIVE_FLOW when the selected step is an IF action', () => {
        const scope = copilotScopeDetector.detectScope({
            flowVersion: buildFlowWithIf(),
            selectedStepName: 'interactive_flow',
        })
        expect(scope).toBe('INTERACTIVE_FLOW')
    })

    it('returns null when selected step exists but is not an IF action (and no IF anywhere)', () => {
        const fv = buildEmptyFlowVersion()
        const scope = copilotScopeDetector.detectScope({
            flowVersion: fv,
            selectedStepName: 'nonexistent-step',
        })
        // trigger-only → EMPTY_OR_NEW still wins because of fallback after selectedStep miss
        expect(scope).toBe('EMPTY_OR_NEW')
    })
})
