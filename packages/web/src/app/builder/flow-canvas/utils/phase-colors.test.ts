import { InteractiveFlowPhase } from '@activepieces/shared';
import { describe, expect, it } from 'vitest';

import { phaseColors } from './phase-colors';

const phases: InteractiveFlowPhase[] = [
  { id: 'p1', name: 'Phase 1', nodeIds: ['a'] },
  { id: 'p2', name: 'Phase 2', nodeIds: ['b'] },
  { id: 'p3', name: 'Phase 3', nodeIds: ['c'] },
];

describe('phaseColors.get', () => {
  it('returns default colors when phaseId is undefined', () => {
    expect(phaseColors.get({ phaseId: undefined, phases })).toEqual(
      phaseColors.defaults,
    );
  });

  it('returns default colors when phases array is undefined', () => {
    expect(phaseColors.get({ phaseId: 'p1', phases: undefined })).toEqual(
      phaseColors.defaults,
    );
  });

  it('returns default colors when phaseId is unknown', () => {
    expect(phaseColors.get({ phaseId: 'unknown', phases })).toEqual(
      phaseColors.defaults,
    );
  });

  it('returns palette[0] for first phase', () => {
    expect(phaseColors.get({ phaseId: 'p1', phases })).toEqual(
      phaseColors.palette[0],
    );
  });

  it('returns palette[1] for second phase', () => {
    expect(phaseColors.get({ phaseId: 'p2', phases })).toEqual(
      phaseColors.palette[1],
    );
  });

  it('returns palette[2] for third phase', () => {
    expect(phaseColors.get({ phaseId: 'p3', phases })).toEqual(
      phaseColors.palette[2],
    );
  });

  it('color is stable across invocations with the same phases array', () => {
    const a = phaseColors.get({ phaseId: 'p2', phases });
    const b = phaseColors.get({ phaseId: 'p2', phases });
    expect(a).toBe(b);
  });

  it('wraps around when more phases than palette entries', () => {
    const manyPhases: InteractiveFlowPhase[] = Array.from({ length: 10 }).map(
      (_, i) => ({ id: `phase${i}`, name: `Phase ${i}`, nodeIds: [`n${i}`] }),
    );
    const color0 = phaseColors.get({ phaseId: 'phase0', phases: manyPhases });
    const paletteLen = phaseColors.palette.length;
    const colorWrapped = phaseColors.get({
      phaseId: `phase${paletteLen}`,
      phases: manyPhases,
    });
    expect(colorWrapped).toEqual(color0);
  });
});

describe('phaseColors.getLabel', () => {
  it('returns phase name for known phaseId', () => {
    expect(phaseColors.getLabel({ phaseId: 'p2', phases })).toBe('Phase 2');
  });

  it('returns undefined for missing phase', () => {
    expect(
      phaseColors.getLabel({ phaseId: 'unknown', phases }),
    ).toBeUndefined();
    expect(
      phaseColors.getLabel({ phaseId: undefined, phases }),
    ).toBeUndefined();
  });
});

describe('phaseColors.getIndex', () => {
  it('returns 0-based index', () => {
    expect(phaseColors.getIndex({ phaseId: 'p1', phases })).toBe(0);
    expect(phaseColors.getIndex({ phaseId: 'p3', phases })).toBe(2);
  });

  it('returns -1 for unknown', () => {
    expect(phaseColors.getIndex({ phaseId: 'unknown', phases })).toBe(-1);
    expect(phaseColors.getIndex({ phaseId: undefined, phases })).toBe(-1);
  });
});
