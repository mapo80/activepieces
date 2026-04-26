import { describe, expect, it } from 'vitest'
import { validateInteractiveFlow } from '../../../../src/app/flows/flow-version/interactive-flow-validator'

const STATE_FIELD = (name: string): { name: string, type: 'string' } => ({ name, type: 'string' })
const BASE_NODE = {
    stateInputs: [] as string[],
    stateOutputs: [] as string[],
}

describe('validateInteractiveFlow', () => {
    it('accepts a minimal empty flow', () => {
        const result = validateInteractiveFlow({ nodes: [], stateFields: [] })
        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
    })

    it('rejects schema violations with INVALID_SCHEMA errors', () => {
        const result = validateInteractiveFlow({
            nodes: [{
                id: 'n1',
                name: 'search',
                displayName: 'Search',
                nodeType: 'TOOL',
                stateInputs: [],
                stateOutputs: [],
                // missing tool → schema violation
            }],
            stateFields: [],
        })
        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.code === 'INVALID_SCHEMA')).toBe(true)
    })

    it('detects duplicate state field names', () => {
        const result = validateInteractiveFlow({
            nodes: [],
            stateFields: [STATE_FIELD('name'), STATE_FIELD('name')],
        })
        expect(result.errors.some(e => e.code === 'DUPLICATE_STATE_FIELD')).toBe(true)
    })

    it('detects duplicate node ids', () => {
        const result = validateInteractiveFlow({
            nodes: [
                { ...BASE_NODE, id: 'n1', name: 'a', displayName: 'A', nodeType: 'TOOL', tool: 'banking/a' },
                { ...BASE_NODE, id: 'n1', name: 'b', displayName: 'B', nodeType: 'TOOL', tool: 'banking/b' },
            ],
            stateFields: [],
        })
        expect(result.errors.some(e => e.code === 'DUPLICATE_NODE_ID')).toBe(true)
    })

    it('detects node references to undeclared state fields', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'n1', name: 'search', displayName: 'Search',
                    nodeType: 'TOOL', tool: 'banking/search',
                    stateInputs: ['clientName'],
                    stateOutputs: ['searchResults'],
                },
            ],
            stateFields: [],  // neither field declared
        })
        const paths = result.errors.filter(e => e.code === 'MISSING_STATE_FIELD').map(e => e.path)
        expect(paths).toContain('nodes.n1.stateInputs')
        expect(paths).toContain('nodes.n1.stateOutputs')
    })

    it('detects duplicate outputs across nodes', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'n1', name: 'collect_a', displayName: 'A',
                    nodeType: 'USER_INPUT',
                    stateInputs: [], stateOutputs: ['clientName'],
                    message: { en: 'name?' },
                    render: { component: 'TextInput', props: {} },
                },
                {
                    id: 'n2', name: 'collect_b', displayName: 'B',
                    nodeType: 'USER_INPUT',
                    stateInputs: [], stateOutputs: ['clientName'],
                    message: { en: 'name again?' },
                    render: { component: 'TextInput', props: {} },
                },
            ],
            stateFields: [STATE_FIELD('clientName')],
        })
        expect(result.errors.some(e => e.code === 'DUPLICATE_OUTPUT')).toBe(true)
    })

    it('detects orphan inputs (field declared but never written)', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'n1', name: 'search', displayName: 'Search',
                    nodeType: 'TOOL', tool: 'banking/search',
                    stateInputs: ['clientName'],
                    stateOutputs: ['searchResults'],
                },
            ],
            stateFields: [STATE_FIELD('clientName'), STATE_FIELD('searchResults')],
        })
        // clientName is not written by any node
        expect(result.errors.some(e => e.code === 'ORPHAN_INPUT')).toBe(true)
    })

    it('detects unknown BRANCH target node ids', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'br', name: 'route', displayName: 'Route',
                    nodeType: 'BRANCH',
                    stateInputs: [], stateOutputs: [],
                    branches: [
                        { id: 'b1', branchType: 'FALLBACK', branchName: 'default', targetNodeIds: ['missing_node'] },
                    ],
                },
            ],
            stateFields: [],
        })
        expect(result.errors.some(e => e.code === 'UNKNOWN_BRANCH_TARGET')).toBe(true)
    })

    it('detects unknown render component names', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'n1', name: 'collect', displayName: 'Collect',
                    nodeType: 'USER_INPUT',
                    stateInputs: [], stateOutputs: ['x'],
                    message: { en: 'x?' },
                    render: { component: 'NotARealComponent', props: {} },
                },
            ],
            stateFields: [STATE_FIELD('x')],
        })
        expect(result.errors.some(e => e.code === 'UNKNOWN_COMPONENT')).toBe(true)
    })

    it('detects cycles in the dependency graph', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'a', name: 'a', displayName: 'A',
                    nodeType: 'TOOL', tool: 'x/a',
                    stateInputs: ['fb'],
                    stateOutputs: ['fa'],
                },
                {
                    id: 'b', name: 'b', displayName: 'B',
                    nodeType: 'TOOL', tool: 'x/b',
                    stateInputs: ['fa'],
                    stateOutputs: ['fb'],
                },
            ],
            stateFields: [STATE_FIELD('fa'), STATE_FIELD('fb')],
        })
        expect(result.errors.some(e => e.code === 'CYCLE')).toBe(true)
    })

    it('accepts a valid non-trivial flow (typed full integration)', () => {
        const result = validateInteractiveFlow({
            nodes: [
                {
                    id: 'collect_name', name: 'collect_name', displayName: 'Collect name',
                    nodeType: 'USER_INPUT',
                    stateInputs: [], stateOutputs: ['clientName'],
                    message: { en: 'What is the client name?' },
                    render: { component: 'TextInput', props: {} },
                },
                {
                    id: 'search', name: 'search', displayName: 'Search',
                    nodeType: 'TOOL', tool: 'banking/search',
                    stateInputs: ['clientName'], stateOutputs: ['searchResults'],
                    toolParams: { name: { kind: 'state', field: 'clientName' } },
                },
                {
                    id: 'pick', name: 'pick', displayName: 'Pick',
                    nodeType: 'USER_INPUT',
                    stateInputs: ['searchResults'], stateOutputs: ['ndg'],
                    message: { en: 'pick one' },
                    render: { component: 'DataTable', props: {} },
                },
                {
                    id: 'confirm', name: 'confirm', displayName: 'Confirm',
                    nodeType: 'CONFIRM',
                    stateInputs: ['ndg'], stateOutputs: ['confirmed'],
                    message: { en: 'confirm?' },
                    render: { component: 'ConfirmCard', props: {} },
                },
            ],
            stateFields: [
                STATE_FIELD('clientName'),
                STATE_FIELD('searchResults'),
                STATE_FIELD('ndg'),
                STATE_FIELD('confirmed'),
            ],
        })
        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
    })

    describe('postgres requirement', () => {
        const baseSettings = { nodes: [], stateFields: [] }

        it('accepts on POSTGRES', () => {
            const result = validateInteractiveFlow({ ...baseSettings, useCommandLayer: true }, { dbType: 'POSTGRES' })
            expect(result.valid).toBe(true)
        })

        it('accepts on PGLITE', () => {
            const result = validateInteractiveFlow({ ...baseSettings, useCommandLayer: true }, { dbType: 'PGLITE' })
            expect(result.valid).toBe(true)
        })

        it('rejects on SQLITE3 with i18n key', () => {
            const result = validateInteractiveFlow({ ...baseSettings, useCommandLayer: true }, { dbType: 'SQLITE3' })
            expect(result.valid).toBe(false)
            const err = result.errors.find(e => e.code === 'COMMAND_LAYER_REQUIRES_POSTGRES')
            expect(err).toBeDefined()
            expect(err?.message).toBe('validation.commandLayer.requiresPostgres')
        })

        it('skips check when dbType is undefined (preserves pure-validator callers)', () => {
            const result = validateInteractiveFlow({ ...baseSettings, useCommandLayer: true })
            expect(result.errors.find(e => e.code === 'COMMAND_LAYER_REQUIRES_POSTGRES')).toBeUndefined()
        })
    })
})
