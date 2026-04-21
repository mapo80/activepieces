// @vitest-environment jsdom
import { InteractiveFlowAction } from '@activepieces/shared';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, beforeAll } from 'vitest';

import { StateFieldsEditor } from './state-fields-editor';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(async () => {
  (
    globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
  ).ResizeObserver = ResizeObserverStub;
  (
    window as unknown as {
      HTMLElement: { prototype: { scrollIntoView?: () => void } };
    }
  ).HTMLElement.prototype.scrollIntoView = () => undefined;
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
    returnNull: false,
    fallbackLng: 'en',
  });
});

function Harness({
  defaultValues,
}: {
  defaultValues: Partial<InteractiveFlowAction>;
}): React.ReactElement {
  const methods = useForm<InteractiveFlowAction>({
    defaultValues: defaultValues as InteractiveFlowAction,
  });
  return (
    <I18nextProvider i18n={i18next}>
      <FormProvider {...methods}>
        <form>
          <StateFieldsEditor readonly={false} />
        </form>
      </FormProvider>
    </I18nextProvider>
  );
}

const BASE_SETTINGS = {
  name: 'interactive_flow',
  displayName: 'Interactive Flow',
  type: 'INTERACTIVE_FLOW' as never,
  skip: false,
  valid: true,
  settings: {
    nodes: [],
    stateFields: [
      { name: 'ndg', type: 'string' as const, extractable: true },
      { name: 'customerMatches', type: 'array' as const, extractable: false },
      {
        name: 'confirmed',
        type: 'boolean' as const,
        extractable: true,
        extractionScope: 'node-local' as const,
      },
    ],
  },
};

describe('StateFieldsEditor — Advanced section', () => {
  it('renders a row per stateField with collapsed Advanced by default', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    expect(screen.getByTestId('state-field-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('state-field-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('state-field-row-2')).toBeInTheDocument();
    // Advanced panel NOT in DOM (Collapsible renders content only when open)
    expect(
      screen.queryByTestId('state-field-row-0-advanced-panel'),
    ).not.toBeInTheDocument();
  });

  it('expands Advanced panel on toggle click', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const toggle = screen.getByTestId('state-field-row-0-advanced-toggle');
    fireEvent.click(toggle);
    expect(
      screen.getByTestId('state-field-row-0-advanced-panel'),
    ).toBeInTheDocument();
  });

  it('expanded Advanced shows Parser select, Pattern, Min/Max, Enum from, Extraction scope', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    fireEvent.click(screen.getByTestId('state-field-row-0-advanced-toggle'));
    const panel = screen.getByTestId('state-field-row-0-advanced-panel');
    expect(panel).toHaveTextContent(/Parser/);
    expect(panel).toHaveTextContent(/Pattern/);
    expect(panel).toHaveTextContent(/Min length/);
    expect(panel).toHaveTextContent(/Max length/);
    expect(panel).toHaveTextContent(/Enum from/);
    expect(panel).toHaveTextContent(/Extraction scope/);
    expect(panel).toHaveTextContent(/Internal/);
  });

  it('enumFrom input wires to the datalist with array-typed stateField names', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    fireEvent.click(screen.getByTestId('state-field-row-0-advanced-toggle'));
    const panel = screen.getByTestId('state-field-row-0-advanced-panel');
    // Datalists are not covered by testing-library's semantic queries; narrowly
    // query the datalist options within the panel to assert the filter.
    // eslint-disable-next-line testing-library/no-node-access
    const datalistOptions = panel.querySelectorAll('datalist option');
    const values = Array.from(datalistOptions).map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toContain('customerMatches');
    expect(values).not.toContain('ndg');
    expect(values).not.toContain('confirmed');
  });

  it('extractionScope select defaults to global (undefined renders as "global")', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    fireEvent.click(screen.getByTestId('state-field-row-0-advanced-toggle'));
    const panel = screen.getByTestId('state-field-row-0-advanced-panel');
    // Radix Select shows the current value in the trigger — for undefined (→ 'global') we expect 'global' in panel
    expect(panel).toHaveTextContent(/global/);
  });

  it('extractionScope on confirmed row reflects node-local from state', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    fireEvent.click(screen.getByTestId('state-field-row-2-advanced-toggle'));
    const panel = screen.getByTestId('state-field-row-2-advanced-panel');
    expect(panel).toHaveTextContent(/node-local/);
  });

  it('base row still exposes name, type select, description, extractable, sensitive', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const row = screen.getByTestId('state-field-row-0');
    // The "extract"/"sensitive" labels are part of the base row layout
    expect(row).toHaveTextContent(/extract/);
    expect(row).toHaveTextContent(/sensitive/);
    // Ensure textboxes (name + description) render inside this row
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes.length).toBeGreaterThan(0);
  });
});
