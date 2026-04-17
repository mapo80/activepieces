import { InteractiveFlowNodeSchema, InteractiveFlowActionSettings, InteractiveFlowNodeType, InteractiveFlowStateFieldSchema } from '../../../src/lib/automation/flows/actions/interactive-flow-action'

describe('InteractiveFlowNodeSchema', () => {
    const validNode = {
        id: 'node_1',
        name: 'search_customer',
        displayName: 'Search Customer',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['clientName'],
        stateOutputs: ['searchResults'],
        tool: 'banking-customers/search_customer',
        toolParams: { name: 'clientName' },
    }

    it('should accept a valid tool node with all required fields', () => {
        const result = InteractiveFlowNodeSchema.safeParse(validNode)
        expect(result.success).toBe(true)
    })

    it('should accept a valid user_input node with render hint', () => {
        const node = {
            id: 'node_2',
            name: 'collect_date',
            displayName: 'Collect Date',
            nodeType: InteractiveFlowNodeType.USER_INPUT,
            stateInputs: [],
            stateOutputs: ['closureEffectiveDate'],
            render: {
                component: 'DatePicker',
                props: { title: 'Select date', minDate: 'today' },
            },
            message: 'When should the closure take effect?',
        }
        const result = InteractiveFlowNodeSchema.safeParse(node)
        expect(result.success).toBe(true)
    })

    it('should accept a valid confirm node with summary', () => {
        const node = {
            id: 'node_3',
            name: 'confirm_closure',
            displayName: 'Confirm Closure',
            nodeType: InteractiveFlowNodeType.CONFIRM,
            stateInputs: ['moduleData'],
            stateOutputs: ['confermaInvio'],
            summary: [
                { label: 'Client', field: 'clientName' },
                { label: 'NDG', field: 'ndg' },
            ],
            render: {
                component: 'ConfirmCard',
                props: { confirmLabel: 'Confirm', cancelLabel: 'Cancel' },
            },
        }
        const result = InteractiveFlowNodeSchema.safeParse(node)
        expect(result.success).toBe(true)
    })

    it('should reject when nodeType is missing', () => {
        const { nodeType: _, ...withoutNodeType } = validNode
        const result = InteractiveFlowNodeSchema.safeParse(withoutNodeType)
        expect(result.success).toBe(false)
    })

    it('should reject when nodeType has an invalid value', () => {
        const result = InteractiveFlowNodeSchema.safeParse({
            ...validNode,
            nodeType: 'INVALID_TYPE',
        })
        expect(result.success).toBe(false)
    })

    it('should accept empty stateInputs array for nodes with no dependencies', () => {
        const result = InteractiveFlowNodeSchema.safeParse({
            ...validNode,
            stateInputs: [],
        })
        expect(result.success).toBe(true)
    })

    it('should reject node name with invalid characters', () => {
        const result = InteractiveFlowNodeSchema.safeParse({
            ...validNode,
            name: 'Invalid Name With Spaces!',
        })
        expect(result.success).toBe(false)
    })

    it('should accept node name with underscores and alphanumeric characters', () => {
        const result = InteractiveFlowNodeSchema.safeParse({
            ...validNode,
            name: 'search_customer_v2',
        })
        expect(result.success).toBe(true)
    })

    it('should accept a valid render hint with component and props', () => {
        const result = InteractiveFlowNodeSchema.safeParse({
            ...validNode,
            render: {
                component: 'DataTable',
                props: { selectable: true, selectField: 'ndg' },
            },
        })
        expect(result.success).toBe(true)
    })

    it('should reject render hint missing component field', () => {
        const result = InteractiveFlowNodeSchema.safeParse({
            ...validNode,
            render: {
                props: { selectable: true },
            },
        })
        expect(result.success).toBe(false)
    })

    it('should accept node without optional fields (tool, render, message)', () => {
        const minimalNode = {
            id: 'node_min',
            name: 'minimal_node',
            displayName: 'Minimal',
            nodeType: InteractiveFlowNodeType.TOOL,
            stateInputs: [],
            stateOutputs: [],
        }
        const result = InteractiveFlowNodeSchema.safeParse(minimalNode)
        expect(result.success).toBe(true)
    })
})

describe('InteractiveFlowStateFieldSchema', () => {
    it('should accept a valid state field with all properties', () => {
        const result = InteractiveFlowStateFieldSchema.safeParse({
            name: 'clientName',
            type: 'string',
            label: 'Client Name',
            description: 'Full name of the banking client',
            extractable: true,
            internal: false,
        })
        expect(result.success).toBe(true)
    })

    it('should accept a minimal state field with only required properties', () => {
        const result = InteractiveFlowStateFieldSchema.safeParse({
            name: 'ndg',
            type: 'string',
        })
        expect(result.success).toBe(true)
    })

    it('should reject invalid type values', () => {
        const result = InteractiveFlowStateFieldSchema.safeParse({
            name: 'test',
            type: 'invalid_type',
        })
        expect(result.success).toBe(false)
    })

    it('should accept all valid type values', () => {
        for (const type of ['string', 'number', 'object', 'array']) {
            const result = InteractiveFlowStateFieldSchema.safeParse({
                name: 'test',
                type,
            })
            expect(result.success).toBe(true)
        }
    })
})

describe('InteractiveFlowActionSettings', () => {
    const validSettings = {
        nodes: [
            {
                id: 'node_1',
                name: 'search_customer',
                displayName: 'Search Customer',
                nodeType: InteractiveFlowNodeType.TOOL,
                stateInputs: ['clientName'],
                stateOutputs: ['searchResults'],
                tool: 'banking-customers/search_customer',
            },
        ],
        stateFields: [
            { name: 'clientName', type: 'string' as const },
            { name: 'searchResults', type: 'array' as const },
        ],
    }

    it('should accept valid settings with nodes and stateFields', () => {
        const result = InteractiveFlowActionSettings.safeParse(validSettings)
        expect(result.success).toBe(true)
    })

    it('should accept empty nodes array', () => {
        const result = InteractiveFlowActionSettings.safeParse({
            ...validSettings,
            nodes: [],
        })
        expect(result.success).toBe(true)
    })

    it('should reject when stateFields is missing', () => {
        const { stateFields: _, ...withoutStateFields } = validSettings
        const result = InteractiveFlowActionSettings.safeParse(withoutStateFields)
        expect(result.success).toBe(false)
    })

    it('should accept settings with greeting and fieldExtractor', () => {
        const result = InteractiveFlowActionSettings.safeParse({
            ...validSettings,
            greeting: 'Welcome! What is the client name?',
            fieldExtractor: {
                enabled: true,
                model: 'claude-sonnet-4',
            },
        })
        expect(result.success).toBe(true)
    })

    it('should accept settings with mcpAuth configuration', () => {
        const result = InteractiveFlowActionSettings.safeParse({
            ...validSettings,
            mcpServerUrl: 'https://mcp-gateway:7860/mcp',
            mcpAuth: {
                type: 'access_token',
                token: 'jwt-token-here',
            },
        })
        expect(result.success).toBe(true)
    })

    it('should reject invalid mcpAuth type', () => {
        const result = InteractiveFlowActionSettings.safeParse({
            ...validSettings,
            mcpAuth: {
                type: 'invalid_auth',
            },
        })
        expect(result.success).toBe(false)
    })

    it('should accept mcpAuth with type none', () => {
        const result = InteractiveFlowActionSettings.safeParse({
            ...validSettings,
            mcpAuth: {
                type: 'none',
            },
        })
        expect(result.success).toBe(true)
    })

    it('should preserve immutability when parsing', () => {
        const original = { ...validSettings }
        const result = InteractiveFlowActionSettings.safeParse(original)
        expect(result.success).toBe(true)
        expect(original.nodes).toHaveLength(1)
    })
})
