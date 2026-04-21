import { describe, expect, it } from 'vitest'
import { metaQuestionHandler } from '../../../../src/app/ai/meta-question-handler'

describe('metaQuestionHandler.detectMetaIntent', () => {
    it('detects "cosa mi avevi chiesto" → ask-repeat', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'cosa mi avevi chiesto?' })).toBe('ask-repeat')
    })

    it('detects "ripeti la domanda" → ask-repeat', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'ripeti la domanda' })).toBe('ask-repeat')
    })

    it('detects "spiegami" → ask-repeat', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'spiegami meglio' })).toBe('ask-repeat')
    })

    it('detects "riassumi" → ask-repeat', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'riassumi quanto raccolto' })).toBe('ask-repeat')
    })

    it('detects "non ho capito" → ask-clarify', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'non ho capito' })).toBe('ask-clarify')
    })

    it('detects "non è chiaro" → ask-clarify', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'non è chiaro' })).toBe('ask-clarify')
    })

    it('detects "a che punto siamo" → ask-progress', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'a che punto siamo?' })).toBe('ask-progress')
    })

    it('detects "dove siamo arrivati" → ask-progress', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'dove siamo arrivati?' })).toBe('ask-progress')
    })

    it('detects "come funziona" → ask-help', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'come funziona?' })).toBe('ask-help')
    })

    it('detects "aiuto" → ask-help', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'aiuto' })).toBe('ask-help')
    })

    it('detects "help" → ask-help', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'help' })).toBe('ask-help')
    })

    it('detects "annulla" → ask-cancel', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'annulla' })).toBe('ask-cancel')
    })

    it('detects "cancel" → ask-cancel', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'cancel' })).toBe('ask-cancel')
    })

    it('returns null for regular task message', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'voglio chiudere il rapporto' })).toBeNull()
    })

    it('returns null for NDG number', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: '11255521' })).toBeNull()
    })

    it('returns null for empty message', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: '' })).toBeNull()
    })

    it('returns null for greetings', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'ciao' })).toBeNull()
    })

    it('false-positive guard: "cosa succede se confermo" is NOT meta-question', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'cosa succede se confermo' })).toBeNull()
    })

    it('case-insensitive', () => {
        expect(metaQuestionHandler.detectMetaIntent({ message: 'RIPETI' })).toBe('ask-repeat')
    })
})

describe('metaQuestionHandler.renderMetaAnswer', () => {
    const baseNode = {
        nodeId: 'pick_ndg',
        displayName: 'Seleziona NDG',
        displayField: 'NDG',
        prompt: 'Qual è il NDG del cliente?',
        nextMissingField: 'NDG',
    }

    it('renders ask-repeat with state and pending field', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { customerName: 'Bellafronte' },
            currentNode: baseNode,
        })
        expect(answer).toContain('Qual è il NDG del cliente')
        expect(answer).toContain('customerName')
        expect(answer).toContain('annulla')
    })

    it('renders ask-repeat without state when empty', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: {},
            currentNode: baseNode,
        })
        expect(answer).toContain('NDG')
        expect(answer).not.toContain('Ho già raccolto')
    })

    it('renders ask-clarify with pending field', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-clarify',
            state: { customerName: 'Bellafronte' },
            currentNode: baseNode,
        })
        expect(answer).toContain('spiegarmi meglio')
        expect(answer).toContain('NDG')
    })

    it('renders ask-progress with node displayName', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-progress',
            state: { customerName: 'Bellafronte' },
            currentNode: baseNode,
        })
        expect(answer).toContain('Seleziona NDG')
        expect(answer).toContain('Manca: NDG')
    })

    it('renders ask-progress with flow label', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-progress',
            state: {},
            currentNode: baseNode,
            flowLabel: "l'estinzione del rapporto",
        })
        expect(answer).toContain("per l'estinzione del rapporto")
    })

    it('renders ask-help', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-help',
            state: {},
            currentNode: baseNode,
        })
        expect(answer).toContain('guidando')
        expect(answer).toContain('NDG')
    })

    it('renders ask-cancel with termination message', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-cancel',
            state: {},
            currentNode: baseNode,
        })
        expect(answer).toContain('interrotta')
    })

    it('falls back when currentNode has no prompt', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: {},
            currentNode: { nodeId: 'x' },
        })
        expect(answer).toContain('la prossima informazione')
    })

    it('formats long string values with ellipsis', () => {
        const longValue = 'X'.repeat(100)
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { note: longValue },
            currentNode: baseNode,
        })
        expect(answer).toContain('…')
    })

    it('formats array values as count', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { customerMatches: [1, 2, 3] },
            currentNode: baseNode,
        })
        expect(answer).toContain('3 elementi')
    })

    it('formats object values as placeholder', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { profile: { nome: 'X' } },
            currentNode: baseNode,
        })
        expect(answer).toContain('(oggetto)')
    })

    it('formats number and boolean values inline', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { age: 42, confirmed: true },
            currentNode: baseNode,
        })
        expect(answer).toContain('42')
        expect(answer).toContain('true')
    })

    it('ignores null/undefined/empty-string values', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { a: null, b: undefined, c: '' },
            currentNode: baseNode,
        })
        expect(answer).not.toContain('Ho già raccolto')
    })

    it('falls back to String() for exotic types (bigint/symbol)', () => {
        const answer = metaQuestionHandler.renderMetaAnswer({
            intent: 'ask-repeat',
            state: { big: 42n },
            currentNode: baseNode,
        })
        expect(answer).toContain('42')
    })
})
