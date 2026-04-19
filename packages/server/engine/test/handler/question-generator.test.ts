import { InteractiveFlowNodeType, InteractiveFlowUserInputNode } from '@activepieces/shared'
import { describe, expect, it, vi } from 'vitest'
import { questionGenerator } from '../../src/lib/handler/question-generator'
import { generateMockEngineConstants } from './test-helper'

function buildUserInputNode(): InteractiveFlowUserInputNode {
    return {
        id: 'ask_ndg',
        name: 'ask_ndg',
        displayName: 'Ask NDG',
        nodeType: InteractiveFlowNodeType.USER_INPUT,
        stateInputs: [],
        stateOutputs: ['ndg'],
        render: { component: 'TextInput', props: { placeholder: 'NDG' } },
        message: { dynamic: true },
    }
}

describe('questionGenerator.generate', () => {

    it('posts structured payload and returns text when provider responds', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ text: 'Qual è il NDG del cliente?', tokensUsed: 42 }),
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const result = await questionGenerator.generate({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o', styleTemplate: 'banking_formal_it' },
            node: buildUserInputNode(),
            stateFields: [{ name: 'ndg', type: 'string', label: { it: 'NDG cliente', en: 'Client NDG' } }],
            currentState: { already: 'set' },
            locale: 'it',
            systemPrompt: 'You are a banking agent',
            history: [{ role: 'user', text: 'estingui' }],
        })

        expect(result).toBe('Qual è il NDG del cliente?')
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toMatch(/\/v1\/engine\/interactive-flow-ai\/question-generate$/)
        const body = JSON.parse((init as { body: string }).body)
        expect(body.locale).toBe('it')
        expect(body.styleTemplate).toBe('banking_formal_it')
        expect(body.targetFields).toEqual([{ name: 'ndg', label: 'NDG cliente', description: undefined, format: undefined }])
        expect(body.renderHint).toEqual({ component: 'TextInput', props: { placeholder: 'NDG' } })
        expect(body.history).toEqual([{ role: 'user', text: 'estingui' }])
    })

    it('redacts sensitive state before sending', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: 'ok', tokensUsed: 0 }),
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        await questionGenerator.generate({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o' },
            node: buildUserInputNode(),
            stateFields: [
                { name: 'ndg', type: 'string' },
                { name: 'pin', type: 'string', sensitive: true },
            ],
            currentState: { ndg: '42', pin: '0000' },
            locale: 'en',
        })

        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.state).toEqual({ ndg: '42' })
    })

    it('returns null when endpoint responds with empty text', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ text: '   ', tokensUsed: 0 }),
        }) as unknown as typeof fetch

        const result = await questionGenerator.generate({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o' },
            node: buildUserInputNode(),
            stateFields: [],
            currentState: {},
            locale: 'en',
        })
        expect(result).toBeNull()
    })

    it('returns null when fetch throws', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch

        const result = await questionGenerator.generate({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o' },
            node: buildUserInputNode(),
            stateFields: [],
            currentState: {},
            locale: 'en',
        })
        expect(result).toBeNull()
    })
})
