import { describe, expect, it } from 'vitest'
import { normalization } from '../../../../src/app/ai/normalization'

describe('normalization.normalize', () => {
    it('returns empty string for empty input', () => {
        expect(normalization.normalize('')).toBe('')
    })

    it('handles null/undefined as empty', () => {
        expect(normalization.normalize(null as unknown as string)).toBe('')
        expect(normalization.normalize(undefined as unknown as string)).toBe('')
    })

    it('strips diacritics (NFKD)', () => {
        expect(normalization.normalize('Caffè')).toBe('caffe')
        expect(normalization.normalize('Perché')).toBe('perche')
        expect(normalization.normalize('Niño')).toBe('nino')
    })

    it('unifies apostrophes', () => {
        expect(normalization.normalize("D'Angelo")).toBe("d'angelo")
        expect(normalization.normalize('D\u2019Angelo')).toBe("d'angelo")
        expect(normalization.normalize('D\u2018Angelo')).toBe("d'angelo")
        expect(normalization.normalize('D`Angelo')).toBe("d'angelo")
    })

    it('unifies dashes', () => {
        expect(normalization.normalize('01\u2013034\u201400392400')).toBe('01-034-00392400')
        expect(normalization.normalize('20–aprile')).toBe('20-aprile')
    })

    it('collapses whitespace', () => {
        expect(normalization.normalize('  hello   world  ')).toBe('hello world')
        expect(normalization.normalize('hello\tworld')).toBe('hello world')
        expect(normalization.normalize('hello\nworld')).toBe('hello world')
    })

    it('converts punctuation to space', () => {
        expect(normalization.normalize('ciao, come stai?')).toBe('ciao come stai')
        expect(normalization.normalize('voglio, estinguere; il rapporto.')).toBe('voglio estinguere il rapporto')
    })

    it('lowercases output', () => {
        expect(normalization.normalize('BELLAFRONTE Gianluca')).toBe('bellafronte gianluca')
    })

    it('preserves digits', () => {
        expect(normalization.normalize('NDG 11255521')).toBe('ndg 11255521')
        expect(normalization.normalize('01-034-00392400')).toBe('01-034-00392400')
    })

    it('handles mixed unicode correctly', () => {
        expect(normalization.normalize('Françoise D\u2019Alembert — 123')).toBe("francoise d'alembert - 123")
    })
})

describe('normalization.normalizePreservingSpans', () => {
    it('returns structured normalized text', () => {
        const result = normalization.normalizePreservingSpans('Caffè 123')
        expect(result.original).toBe('Caffè 123')
        expect(result.normalized).toBe('caffe 123')
        expect(result.originalToNormalizedMap.length).toBeGreaterThan(0)
    })

    it('handles empty input', () => {
        const result = normalization.normalizePreservingSpans('')
        expect(result.normalized).toBe('')
    })
})

describe('normalization.locateEvidence', () => {
    it('returns matched=true when evidence is literal substring (normalized)', () => {
        const normalized = normalization.normalizePreservingSpans('voglio chiudere il rapporto di Bellafronte')
        const result = normalization.locateEvidence({ evidence: 'Bellafronte', normalized })
        expect(result.matched).toBe(true)
        if (result.matched) {
            expect(result.normalizedSpan.start).toBeGreaterThanOrEqual(0)
            expect(result.normalizedSpan.end).toBeGreaterThan(result.normalizedSpan.start)
        }
    })

    it('matches case-insensitively via normalization', () => {
        const normalized = normalization.normalizePreservingSpans('Rapporto 01-034-00392400 per BELLAFRONTE')
        const result = normalization.locateEvidence({ evidence: 'bellafronte', normalized })
        expect(result.matched).toBe(true)
    })

    it('matches with diacritics removed', () => {
        const normalized = normalization.normalizePreservingSpans('cliente Perché')
        const result = normalization.locateEvidence({ evidence: 'perche', normalized })
        expect(result.matched).toBe(true)
    })

    it('returns matched=false for non-substring', () => {
        const normalized = normalization.normalizePreservingSpans('voglio Bellafronte')
        const result = normalization.locateEvidence({ evidence: 'Rossi', normalized })
        expect(result.matched).toBe(false)
        if (!result.matched) expect(result.reason).toBe('not-substring')
    })

    it('returns matched=false for evidence too short', () => {
        const normalized = normalization.normalizePreservingSpans('voglio X')
        const result = normalization.locateEvidence({ evidence: 'X', normalized })
        expect(result.matched).toBe(false)
        if (!result.matched) expect(result.reason).toBe('evidence-too-short')
    })

    it('does not match paraphrase or synonym', () => {
        const normalized = normalization.normalizePreservingSpans('sono arrabbiato')
        const result = normalization.locateEvidence({ evidence: 'irritato', normalized })
        expect(result.matched).toBe(false)
    })
})

describe('normalization.spansOverlap', () => {
    it('returns true when spans overlap', () => {
        expect(normalization.spansOverlap({ a: { start: 0, end: 5 }, b: { start: 3, end: 8 } })).toBe(true)
    })

    it('returns false when spans do not overlap', () => {
        expect(normalization.spansOverlap({ a: { start: 0, end: 5 }, b: { start: 5, end: 8 } })).toBe(false)
        expect(normalization.spansOverlap({ a: { start: 0, end: 5 }, b: { start: 10, end: 15 } })).toBe(false)
    })

    it('contained spans overlap', () => {
        expect(normalization.spansOverlap({ a: { start: 0, end: 10 }, b: { start: 3, end: 7 } })).toBe(true)
    })
})

describe('normalization.unionSpans', () => {
    it('returns empty array for empty input', () => {
        expect(normalization.unionSpans({ spans: [] })).toEqual([])
    })

    it('returns single span unchanged', () => {
        expect(normalization.unionSpans({ spans: [{ start: 0, end: 5 }] })).toEqual([{ start: 0, end: 5 }])
    })

    it('merges overlapping spans', () => {
        const result = normalization.unionSpans({
            spans: [{ start: 0, end: 5 }, { start: 3, end: 8 }],
        })
        expect(result).toEqual([{ start: 0, end: 8 }])
    })

    it('preserves disjoint spans', () => {
        const result = normalization.unionSpans({
            spans: [{ start: 0, end: 3 }, { start: 10, end: 15 }],
        })
        expect(result).toEqual([{ start: 0, end: 3 }, { start: 10, end: 15 }])
    })

    it('handles unsorted input', () => {
        const result = normalization.unionSpans({
            spans: [{ start: 10, end: 15 }, { start: 0, end: 3 }, { start: 12, end: 18 }],
        })
        expect(result).toEqual([{ start: 0, end: 3 }, { start: 10, end: 18 }])
    })

    it('merges adjacent spans (touching)', () => {
        const result = normalization.unionSpans({
            spans: [{ start: 0, end: 5 }, { start: 5, end: 10 }],
        })
        expect(result).toEqual([{ start: 0, end: 10 }])
    })
})

describe('normalization.removeSpans', () => {
    it('returns text unchanged when no spans', () => {
        expect(normalization.removeSpans({ text: 'hello world', spans: [] })).toBe('hello world')
    })

    it('removes a single span with default space replacement', () => {
        expect(normalization.removeSpans({
            text: 'the 20 aprile 2026 date',
            spans: [{ start: 4, end: 18 }],
        })).toBe('the   date')
    })

    it('removes multiple spans', () => {
        expect(normalization.removeSpans({
            text: 'NDG 11255521 rapporto 01-034-00392400 ok',
            spans: [{ start: 4, end: 12 }, { start: 22, end: 37 }],
        })).toBe('NDG   rapporto   ok')
    })

    it('supports custom replacement string', () => {
        expect(normalization.removeSpans({
            text: 'a BC d',
            spans: [{ start: 2, end: 4 }],
            replacement: '__',
        })).toBe('a __ d')
    })

    it('handles overlapping spans via union', () => {
        expect(normalization.removeSpans({
            text: 'abcdefghij',
            spans: [{ start: 0, end: 5 }, { start: 3, end: 8 }],
        })).toBe(' ij')
    })
})
