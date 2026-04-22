import { describe, expect, it } from 'vitest'
import { copilotInverseOp } from '../../../../../src/app/ai/copilot/inverse-op'
import { FlowActionType, FlowOperationType, FlowTriggerType, FlowVersion } from '@activepieces/shared'

function fvWithIf(settings: { stateFields: unknown[]; nodes: unknown[] }): FlowVersion {
    return {
        id: 'fv',
        flowId: 'f',
        displayName: 'x',
        schemaVersion: '1',
        created: '2026-01-01',
        updated: '2026-01-01',
        trigger: {
            type: FlowTriggerType.EMPTY,
            name: 'trigger',
            displayName: 'start',
            valid: true,
            settings: {},
            nextAction: {
                type: FlowActionType.INTERACTIVE_FLOW,
                name: 'interactive_flow',
                displayName: 'IF',
                valid: true,
                settings,
            },
        },
    } as unknown as FlowVersion
}

describe('copilotInverseOp.computeInverse', () => {
    it('UPDATE_ACTION inverse contains the full pre-state settings', () => {
        const before = fvWithIf({ stateFields: [{ name: 'existing', type: 'string', extractable: true, description: 'x' }], nodes: [] })
        const inv = copilotInverseOp.computeInverse({
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    type: FlowActionType.INTERACTIVE_FLOW,
                    name: 'interactive_flow',
                    displayName: 'IF',
                    valid: true,
                    settings: { stateFields: [], nodes: [] },
                },
            } as never,
            beforeFlowVersion: before,
        })
        expect(inv.kind).toBe('flow-operation')
        if (inv.kind === 'flow-operation') {
            expect(inv.op.type).toBe(FlowOperationType.UPDATE_ACTION)
            const req = (inv.op as { request: { settings: { stateFields: unknown[] } } }).request
            expect(req.settings.stateFields.length).toBe(1)
        }
    })

    it('ADD_ACTION inverse is a DELETE_ACTION for the same step name', () => {
        const before = fvWithIf({ stateFields: [], nodes: [] })
        const inv = copilotInverseOp.computeInverse({
            op: {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: 'trigger',
                    action: {
                        type: FlowActionType.INTERACTIVE_FLOW,
                        name: 'new_if',
                        displayName: 'New',
                        valid: true,
                        settings: { nodes: [], stateFields: [] },
                    },
                },
            } as never,
            beforeFlowVersion: before,
        })
        if (inv.kind === 'flow-operation') {
            expect(inv.op.type).toBe(FlowOperationType.DELETE_ACTION)
            const req = (inv.op as { request: { names: string[] } }).request
            expect(req.names).toEqual(['new_if'])
        }
    })

    it('UPDATE_TRIGGER inverse replaces with pre-state trigger', () => {
        const before = fvWithIf({ stateFields: [], nodes: [] })
        const inv = copilotInverseOp.computeInverse({
            op: {
                type: FlowOperationType.UPDATE_TRIGGER,
                request: { type: FlowTriggerType.EMPTY, name: 'x', displayName: 'y', valid: true, settings: {} },
            } as never,
            beforeFlowVersion: before,
        })
        if (inv.kind === 'flow-operation') {
            expect(inv.op.type).toBe(FlowOperationType.UPDATE_TRIGGER)
        }
    })

    it('UPDATE_ACTION on missing step throws', () => {
        const before = fvWithIf({ stateFields: [], nodes: [] })
        expect(() =>
            copilotInverseOp.computeInverse({
                op: {
                    type: FlowOperationType.UPDATE_ACTION,
                    request: {
                        type: FlowActionType.INTERACTIVE_FLOW,
                        name: 'missing',
                        displayName: '',
                        valid: true,
                        settings: { stateFields: [], nodes: [] },
                    },
                } as never,
                beforeFlowVersion: before,
            }),
        ).toThrow()
    })
})
