// @vitest-environment jsdom
import {
  InteractiveFlowAction,
  InteractiveFlowNodeType,
} from '@activepieces/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { NodesEditor } from './nodes-editor';

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

const BASE_SETTINGS: Partial<InteractiveFlowAction> = {
  name: 'interactive_flow',
  displayName: 'Interactive Flow',
  type: 'INTERACTIVE_FLOW' as never,
  skip: false,
  valid: true,
  settings: {
    nodes: [
      {
        id: 'search_customer',
        name: 'search_customer',
        displayName: 'Search customer',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['customerName'],
        stateOutputs: ['customerMatches'],
        tool: 'banking-customers/search_customer',
      },
      {
        id: 'pick_ndg',
        name: 'pick_ndg',
        displayName: 'Pick NDG',
        nodeType: InteractiveFlowNodeType.USER_INPUT,
        stateInputs: ['customerMatches'],
        stateOutputs: ['ndg'],
        render: { component: 'DataTable', props: {} },
        message: { dynamic: true },
      },
      {
        id: 'load_profile',
        name: 'load_profile',
        displayName: 'Load profile',
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: ['ndg'],
        stateOutputs: ['profile'],
        tool: 'banking-customers/get_profile',
      },
      {
        id: 'confirm_closure',
        name: 'confirm_closure',
        displayName: 'Confirm closure',
        nodeType: InteractiveFlowNodeType.CONFIRM,
        stateInputs: ['profile'],
        stateOutputs: ['confirmed'],
        render: { component: 'ConfirmCard', props: {} },
        message: { dynamic: true },
      },
    ],
    stateFields: [],
  } as InteractiveFlowAction['settings'],
};

function Harness({
  defaultValues,
}: {
  defaultValues: Partial<InteractiveFlowAction>;
}): React.ReactElement {
  const methods = useForm<InteractiveFlowAction>({
    defaultValues: defaultValues as InteractiveFlowAction,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <I18nextProvider i18n={i18next}>
      <QueryClientProvider client={queryClient}>
        <FormProvider {...methods}>
          <form>
            <NodesEditor readonly={false} />
          </form>
        </FormProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

describe('NodesEditor — node list', () => {
  it('groups nodes by nodeType by default (TOOL/USER_INPUT/CONFIRM)', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    expect(screen.getByTestId('nodes-group-TOOL')).toBeInTheDocument();
    expect(screen.getByTestId('nodes-group-USER_INPUT')).toBeInTheDocument();
    expect(screen.getByTestId('nodes-group-CONFIRM')).toBeInTheDocument();
  });

  it('omits empty buckets (BRANCH when no branch nodes present)', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    expect(screen.queryByTestId('nodes-group-BRANCH')).not.toBeInTheDocument();
  });

  it('renders group headers with correct node counts', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const toolGroup = screen.getByTestId('nodes-group-TOOL');
    expect(toolGroup).toHaveTextContent(/TOOL \(2\)/);
    const userInputGroup = screen.getByTestId('nodes-group-USER_INPUT');
    expect(userInputGroup).toHaveTextContent(/USER_INPUT \(1\)/);
  });

  it('preserves array order within each bucket', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const toolGroup = screen.getByTestId('nodes-group-TOOL');
    expect(toolGroup).toHaveTextContent(/search_customer/);
    expect(toolGroup).toHaveTextContent(/load_profile/);
    const idxSearch = toolGroup.textContent!.indexOf('search_customer');
    const idxLoad = toolGroup.textContent!.indexOf('load_profile');
    expect(idxSearch).toBeLessThan(idxLoad);
  });

  it('toggle OFF flattens to array order (no group headers)', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    fireEvent.click(screen.getByTestId('nodes-group-by-type-toggle'));
    expect(screen.queryByTestId('nodes-group-TOOL')).not.toBeInTheDocument();
    expect(screen.getByTestId('nodes-flat')).toBeInTheDocument();
  });

  it('each TOOL card renders the Wrench-like icon via blue left border', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const card = screen.getByTestId('node-card-0');
    expect(card.className).toMatch(/border-l-blue-500/);
  });

  it('each USER_INPUT card has emerald left border', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const card = screen.getByTestId('node-card-1');
    expect(card.className).toMatch(/border-l-emerald-500/);
  });

  it('each CONFIRM card has amber left border', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    const card = screen.getByTestId('node-card-3');
    expect(card.className).toMatch(/border-l-amber-500/);
  });

  it('clicking a node still selects the right array index regardless of display mode', () => {
    render(<Harness defaultValues={BASE_SETTINGS} />);
    // In grouped mode, click node-card-3 (CONFIRM) which is arrayIndex=3
    fireEvent.click(screen.getByTestId('node-card-3'));
    // Detail panel updates; the Name input reflects the selected node
    const nameInputs = screen.getAllByRole('textbox');
    const hasConfirmValue = nameInputs.some(
      (el) => (el as HTMLInputElement).value === 'confirm_closure',
    );
    expect(hasConfirmValue).toBe(true);
  });
});
