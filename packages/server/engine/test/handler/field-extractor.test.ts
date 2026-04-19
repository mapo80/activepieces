import { describe, expect, it, vi } from 'vitest'
import { fieldExtractor } from '../../src/lib/handler/field-extractor'
import { generateMockEngineConstants } from './test-helper'

describe('fieldExtractor.extract', () => {

    it('posts payload with extractable (non-sensitive) fields and returns extracted values', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ extractedFields: { ndg: '42', clientName: 'Polito' }, tokensUsed: 57 }),
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const result = await fieldExtractor.extract({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            message: 'estingui rapporto di Polito, ndg 42',
            stateFields: [
                { name: 'ndg', type: 'string', extractable: true },
                { name: 'clientName', type: 'string', extractable: true },
                { name: 'password', type: 'string', sensitive: true },
            ],
            currentState: {},
            systemPrompt: 'Banking agent',
            locale: 'it',
        })

        expect(result).toEqual({ ndg: '42', clientName: 'Polito' })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toMatch(/\/v1\/engine\/interactive-flow-ai\/field-extract$/)
        const body = JSON.parse((init as { body: string }).body)
        expect(body.stateFields.map((f: { name: string }) => f.name)).toEqual(['ndg', 'clientName'])
        expect(body.systemPrompt).toBe('Banking agent')
        expect(body.locale).toBe('it')
    })

    it('redacts sensitive values from the currentState payload', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ extractedFields: {}, tokensUsed: 0 }),
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        await fieldExtractor.extract({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o' },
            message: 'hi',
            stateFields: [
                { name: 'clientName', type: 'string', extractable: true },
                { name: 'ssn', type: 'string', sensitive: true },
            ],
            currentState: { clientName: 'Polito', ssn: '1234' },
        })

        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.currentState).toEqual({ clientName: 'Polito' })
    })

    it('returns {} when no extractable fields are defined', async () => {
        const fetchMock = vi.fn()
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const result = await fieldExtractor.extract({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            message: 'hi',
            stateFields: [{ name: 'secret', type: 'string', sensitive: true }],
            currentState: {},
        })

        expect(result).toEqual({})
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns {} when the endpoint responds non-ok', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch

        const result = await fieldExtractor.extract({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            message: 'hi',
            stateFields: [{ name: 'clientName', type: 'string', extractable: true }],
            currentState: {},
        })
        expect(result).toEqual({})
    })

    it('returns {} when fetch throws (network failure)', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch

        const result = await fieldExtractor.extract({
            constants: generateMockEngineConstants(),
            config: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            message: 'hi',
            stateFields: [{ name: 'clientName', type: 'string', extractable: true }],
            currentState: {},
        })
        expect(result).toEqual({})
    })
})
