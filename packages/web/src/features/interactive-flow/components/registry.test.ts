// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { interactiveFlowComponentRegistry } from './registry';

describe('interactiveFlowComponentRegistry', () => {
  it('exposes exactly the 6 canonical components', () => {
    const names = interactiveFlowComponentRegistry.listComponentNames().sort();
    expect(names).toEqual([
      'ClientCard',
      'ConfirmCard',
      'DataTable',
      'DatePickerCard',
      'DocumentCard',
      'TextInput',
    ]);
  });

  it('validates TextInput props against its schema (placeholder string, multiline bool)', () => {
    const entry = interactiveFlowComponentRegistry.getEntry('TextInput');
    expect(entry).toBeDefined();
    const good = entry!.propsSchema.safeParse({
      placeholder: 'Name',
      multiline: true,
    });
    expect(good.success).toBe(true);
    const bad = entry!.propsSchema.safeParse({ maxLength: -3 });
    expect(bad.success).toBe(false);
  });

  it('validates DataTable columns schema', () => {
    const entry = interactiveFlowComponentRegistry.getEntry('DataTable');
    expect(entry).toBeDefined();
    const good = entry!.propsSchema.safeParse({
      columns: [{ key: 'id', label: 'ID' }],
    });
    expect(good.success).toBe(true);
    const bad = entry!.propsSchema.safeParse({
      columns: [{ key: 'id' }],
    });
    expect(bad.success).toBe(false);
  });

  it('returns a fresh sample state each call', () => {
    const entry = interactiveFlowComponentRegistry.getEntry('ClientCard');
    expect(entry).toBeDefined();
    const sample = entry!.sampleState({});
    expect(sample).toMatchObject({ name: 'Mario Polito', ndg: 'NDG-42' });
  });

  it('returns undefined for an unknown component name', () => {
    expect(
      interactiveFlowComponentRegistry.getEntry('DoesNotExist'),
    ).toBeUndefined();
  });
});
