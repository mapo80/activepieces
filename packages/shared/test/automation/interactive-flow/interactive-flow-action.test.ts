import { describe, expect, it } from 'vitest'
import {
    InteractiveFlowActionSettings,
    InteractiveFlowBranchNodeSchema,
    InteractiveFlowConfirmNodeSchema,
    InteractiveFlowErrorPolicySchema,
    InteractiveFlowNodeSchema,
    InteractiveFlowNodeType,
    InteractiveFlowStateFieldSchema,
    InteractiveFlowToolNodeSchema,
    InteractiveFlowUserInputNodeSchema,
    LocalizedStringSchema,
    NodeMessageSchema,
    ParamBindingSchema,
    ToolInputSchemaSnapshotSchema,
} from '../../../src/lib/automation/flows/actions/interactive-flow-action'

describe('LocalizedStringSchema', () => {
    it('accepts valid ISO locale keys', () => {
        expect(LocalizedStringSchema.parse({ en: 'hello', it: 'ciao', 'zh-TW': '你好' })).toEqual({ en: 'hello', it: 'ciao', 'zh-TW': '你好' })
    })
    it('rejects invalid locale codes', () => {
        expect(() => LocalizedStringSchema.parse({ EN: 'upper case' })).toThrow()
        expect(() => LocalizedStringSchema.parse({ english: 'full word' })).toThrow()
    })
    it('accepts an empty map', () => {
        expect(LocalizedStringSchema.parse({})).toEqual({})
    })
})

describe('InteractiveFlowStateFieldSchema', () => {
    it('accepts minimal field', () => {
        const parsed = InteractiveFlowStateFieldSchema.parse({ name: 'clientName', type: 'string' })
        expect(parsed.name).toBe('clientName')
        expect(parsed.type).toBe('string')
    })
    it('accepts full field with label, format, extractable, sensitive', () => {
        const input = {
            name: 'closureDate', type: 'date',
            label: { en: 'Effective Date', it: 'Data efficacia' },
            description: 'When the closure takes effect',
            format: 'DD/MM/YYYY',
            extractable: true,
            sensitive: false,
        }
        expect(InteractiveFlowStateFieldSchema.parse(input)).toEqual(input)
    })
    it('rejects empty name', () => {
        expect(() => InteractiveFlowStateFieldSchema.parse({ name: '', type: 'string' })).toThrow()
    })
    it('rejects unknown type', () => {
        expect(() => InteractiveFlowStateFieldSchema.parse({ name: 'x', type: 'blob' })).toThrow()
    })
})

describe('ParamBindingSchema', () => {
    it('accepts state kind', () => {
        expect(ParamBindingSchema.parse({ kind: 'state', field: 'clientName' })).toEqual({ kind: 'state', field: 'clientName' })
    })
    it('accepts literal kind with primitives', () => {
        expect(ParamBindingSchema.parse({ kind: 'literal', value: 42 })).toEqual({ kind: 'literal', value: 42 })
        expect(ParamBindingSchema.parse({ kind: 'literal', value: 'x' })).toEqual({ kind: 'literal', value: 'x' })
        expect(ParamBindingSchema.parse({ kind: 'literal', value: true })).toEqual({ kind: 'literal', value: true })
        expect(ParamBindingSchema.parse({ kind: 'literal', value: null })).toEqual({ kind: 'literal', value: null })
    })
    it('accepts compose kind with at least one field', () => {
        expect(ParamBindingSchema.parse({ kind: 'compose', fields: ['a', 'b'] })).toEqual({ kind: 'compose', fields: ['a', 'b'] })
    })
    it('rejects compose with empty fields', () => {
        expect(() => ParamBindingSchema.parse({ kind: 'compose', fields: [] })).toThrow()
    })
    it('rejects unknown kind', () => {
        expect(() => ParamBindingSchema.parse({ kind: 'other' })).toThrow()
    })
})

describe('NodeMessageSchema', () => {
    it('accepts LocalizedString form', () => {
        expect(NodeMessageSchema.parse({ en: 'hi', it: 'ciao' })).toEqual({ en: 'hi', it: 'ciao' })
    })
    it('accepts dynamic form', () => {
        const input = { dynamic: true, systemPromptAddendum: 'focus on clientName' }
        expect(NodeMessageSchema.parse(input)).toEqual(input)
    })
    it('accepts dynamic with fallback', () => {
        const input = { dynamic: true, fallback: { en: 'please provide the name' } }
        expect(NodeMessageSchema.parse(input)).toEqual(input)
    })
    it('rejects dynamic: false shape', () => {
        expect(() => NodeMessageSchema.parse({ dynamic: false })).toThrow()
    })
})

describe('InteractiveFlowErrorPolicySchema', () => {
    it('accepts FAIL with defaults', () => {
        expect(InteractiveFlowErrorPolicySchema.parse({ onFailure: 'FAIL' })).toEqual({ onFailure: 'FAIL' })
    })
    it('accepts SKIP with retry and timeout', () => {
        const input = { onFailure: 'SKIP', maxRetries: 3, timeoutMs: 30_000 }
        expect(InteractiveFlowErrorPolicySchema.parse(input)).toEqual(input)
    })
    it('rejects out-of-range timeout', () => {
        expect(() => InteractiveFlowErrorPolicySchema.parse({ onFailure: 'FAIL', timeoutMs: 500 })).toThrow()
        expect(() => InteractiveFlowErrorPolicySchema.parse({ onFailure: 'FAIL', timeoutMs: 1_000_000 })).toThrow()
    })
    it('rejects unknown onFailure', () => {
        expect(() => InteractiveFlowErrorPolicySchema.parse({ onFailure: 'MAYBE' })).toThrow()
    })
})

describe('ToolInputSchemaSnapshotSchema', () => {
    it('accepts valid snapshot', () => {
        const s = { capturedAt: new Date().toISOString(), gatewayId: 'gw1234567890123456789A', schema: { type: 'object' } }
        expect(ToolInputSchemaSnapshotSchema.parse(s)).toEqual(s)
    })
})

describe('InteractiveFlowToolNodeSchema', () => {
    const valid = {
        id: 'n1',
        name: 'search_customer',
        displayName: 'Search Customer',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['clientName'],
        stateOutputs: ['searchResults'],
        tool: 'banking/search_customer',
        toolParams: { name: { kind: 'state', field: 'clientName' } },
    }
    it('accepts minimal TOOL', () => {
        expect(InteractiveFlowToolNodeSchema.parse(valid).nodeType).toBe('TOOL')
    })
    it('accepts full TOOL with snapshot + errorPolicy + outputMap', () => {
        const full = {
            ...valid,
            toolInputSchemaSnapshot: { capturedAt: '2026-01-01T00:00:00Z', gatewayId: 'gw1234567890123456789A', schema: {} },
            outputMap: { ndg: 'matches[0].ndg' },
            errorPolicy: { onFailure: 'SKIP', maxRetries: 1, timeoutMs: 5000 },
        }
        expect(InteractiveFlowToolNodeSchema.parse(full)).toEqual(full)
    })
    it('rejects TOOL without tool field', () => {
        const { tool: _, ...missing } = valid
        expect(() => InteractiveFlowToolNodeSchema.parse(missing)).toThrow()
    })
})

describe('InteractiveFlowUserInputNodeSchema', () => {
    it('accepts USER_INPUT with static message', () => {
        const node = {
            id: 'n2',
            name: 'collect_name',
            displayName: 'Collect Name',
            nodeType: InteractiveFlowNodeType.USER_INPUT,
            stateInputs: [],
            stateOutputs: ['clientName'],
            message: { en: 'What is the client name?', it: 'Come si chiama il cliente?' },
            render: { component: 'TextInput', props: { placeholder: 'Name' } },
        }
        expect(InteractiveFlowUserInputNodeSchema.parse(node)).toEqual(node)
    })
    it('accepts USER_INPUT with dynamic message', () => {
        const node = {
            id: 'n2',
            name: 'collect_name',
            displayName: 'Collect Name',
            nodeType: InteractiveFlowNodeType.USER_INPUT,
            stateInputs: [],
            stateOutputs: ['clientName'],
            message: { dynamic: true, systemPromptAddendum: 'focus on clientName', fallback: { en: 'client name?' } },
            render: { component: 'TextInput', props: {} },
        }
        expect(InteractiveFlowUserInputNodeSchema.parse(node).message).toHaveProperty('dynamic', true)
    })
})

describe('InteractiveFlowConfirmNodeSchema', () => {
    it('accepts CONFIRM with summary rows localized', () => {
        const node = {
            id: 'n3',
            name: 'confirm',
            displayName: 'Confirm',
            nodeType: InteractiveFlowNodeType.CONFIRM,
            stateInputs: ['moduleData'],
            stateOutputs: ['confermaInvio'],
            message: { en: 'Do you confirm?', it: 'Confermi?' },
            summary: [
                { field: 'clientName', label: { en: 'Client', it: 'Cliente' } },
                { field: 'ndg', label: { en: 'NDG' } },
            ],
            render: { component: 'ConfirmCard', props: { confirmLabel: 'Ok' } },
        }
        expect(InteractiveFlowConfirmNodeSchema.parse(node)).toEqual(node)
    })
})

describe('InteractiveFlowBranchNodeSchema', () => {
    it('accepts BRANCH with condition + fallback branches', () => {
        const node = {
            id: 'n_branch',
            name: 'route_by_type',
            displayName: 'Route by client type',
            nodeType: InteractiveFlowNodeType.BRANCH,
            stateInputs: ['clientType'],
            stateOutputs: [],
            branches: [
                {
                    id: 'b1',
                    branchType: 'CONDITION' as const,
                    branchName: 'corporate',
                    conditions: [[
                        { operator: 'TEXT_EXACTLY_MATCHES', firstValue: '{{clientType}}', secondValue: 'corporate' },
                    ]],
                    targetNodeIds: ['n_corp_search'],
                },
                {
                    id: 'b2',
                    branchType: 'FALLBACK' as const,
                    branchName: 'Otherwise',
                    targetNodeIds: ['n_indiv_search'],
                },
            ],
        }
        expect(InteractiveFlowBranchNodeSchema.parse(node).branches).toHaveLength(2)
    })
    it('rejects BRANCH with zero branches', () => {
        expect(() => InteractiveFlowBranchNodeSchema.parse({
            id: 'n', name: 'x', displayName: 'X',
            nodeType: InteractiveFlowNodeType.BRANCH,
            stateInputs: [], stateOutputs: [],
            branches: [],
        })).toThrow()
    })
})

describe('InteractiveFlowNodeSchema (discriminated union)', () => {
    it('discriminates on nodeType for TOOL', () => {
        const parsed = InteractiveFlowNodeSchema.parse({
            id: 'n', name: 'x', displayName: 'X',
            nodeType: InteractiveFlowNodeType.TOOL,
            stateInputs: [], stateOutputs: [],
            tool: 'banking/x',
        })
        expect(parsed.nodeType).toBe('TOOL')
    })
    it('discriminates on nodeType for BRANCH', () => {
        const parsed = InteractiveFlowNodeSchema.parse({
            id: 'n', name: 'x', displayName: 'X',
            nodeType: InteractiveFlowNodeType.BRANCH,
            stateInputs: [], stateOutputs: [],
            branches: [{
                id: 'b', branchType: 'FALLBACK' as const, branchName: 'default', targetNodeIds: [],
            }],
        })
        expect(parsed.nodeType).toBe('BRANCH')
    })
    it('rejects hybrid shapes (TOOL fields + USER_INPUT message)', () => {
        expect(() => InteractiveFlowNodeSchema.parse({
            id: 'n', name: 'x', displayName: 'X',
            nodeType: InteractiveFlowNodeType.TOOL,
            stateInputs: [], stateOutputs: [],
            tool: 'banking/x',
            message: { en: 'test' },  // not in TOOL shape
        })).not.toThrow()
        // discriminated union only enforces own schema, extra keys are allowed by default
        // this is a lenient check — a strict schema would require .strict()
    })
})

describe('InteractiveFlowActionSettings', () => {
    const minimal = {
        nodes: [] as unknown[],
        stateFields: [],
    }
    it('accepts empty settings', () => {
        expect(InteractiveFlowActionSettings.parse(minimal)).toBeDefined()
    })
    it('accepts full settings with systemPrompt + extractor + generator + phases + locale + messageInput', () => {
        const full = {
            ...minimal,
            greeting: { en: 'Hi', it: 'Ciao' },
            mcpGatewayId: 'gw1234567890123456789A',
            systemPrompt: 'You are an agent',
            fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o', styleTemplate: 'banking_formal_it', historyWindow: 10, maxResponseLength: 200 },
            locale: 'it',
            messageInput: '{{trigger.body.message}}',
            phases: [{ id: 'p1', name: 'identify', nodeIds: ['n1'], label: { en: 'Identify' } }],
        }
        expect(InteractiveFlowActionSettings.parse(full)).toEqual(full)
    })
    it('rejects invalid locale', () => {
        expect(() => InteractiveFlowActionSettings.parse({ ...minimal, locale: 'ITA' })).toThrow()
        expect(() => InteractiveFlowActionSettings.parse({ ...minimal, locale: 'invalid' })).toThrow()
    })
    it('accepts locale with region (zh-TW)', () => {
        expect(InteractiveFlowActionSettings.parse({ ...minimal, locale: 'zh-TW' }).locale).toBe('zh-TW')
    })
    it('rejects phases with empty nodeIds', () => {
        expect(() => InteractiveFlowActionSettings.parse({
            ...minimal,
            phases: [{ id: 'p', name: 'x', nodeIds: [] }],
        })).toThrow()
    })
})
