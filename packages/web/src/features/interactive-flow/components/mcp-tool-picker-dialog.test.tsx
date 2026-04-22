// @vitest-environment jsdom
import { McpGatewayToolSummary } from '@activepieces/shared';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpGatewaysApi } from '@/features/mcp-gateways/lib/mcp-gateways-api';

import { McpToolPickerDialog } from './mcp-tool-picker-dialog';

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

const MOCK_TOOLS: McpGatewayToolSummary[] = [
  {
    name: 'banking-customers/search_customer',
    description: 'Search customers by surname. Returns NDG matches.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Customer surname' },
      },
      required: ['name'],
    },
  },
  {
    name: 'banking-customers/get_customer_profile',
    description: 'Fetch full customer profile by NDG.',
    inputSchema: {
      type: 'object',
      properties: { ndg: { type: 'string' } },
      required: ['ndg'],
    },
  },
  {
    name: 'banking-accounts/list_accounts',
    description: 'List all accounts for an NDG.',
    inputSchema: {
      type: 'object',
      properties: { ndg: { type: 'string' } },
    },
  },
  {
    name: 'banking-operations/list_closure_reasons',
    description: 'Return the catalog of closure reason codes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'banking-operations/submit_closure',
    description: 'Submit the closure request to the Core Banking.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'object', description: 'Closure payload' },
      },
      required: ['request'],
    },
  },
];

function renderPicker(overrides?: {
  tools?: McpGatewayToolSummary[];
  gatewayId?: string | null;
  currentValue?: string;
  onSelect?: (toolName: string, schema: unknown) => void;
  isError?: boolean;
}): {
  onSelect: (name: string, schema: unknown) => void;
} {
  const onSelect = overrides?.onSelect ?? vi.fn();
  const spy = vi.spyOn(mcpGatewaysApi, 'listTools').mockResolvedValue({
    tools: overrides?.tools ?? MOCK_TOOLS,
  });
  if (overrides?.isError) {
    spy.mockRejectedValue(new Error('network'));
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18next}>
      <QueryClientProvider client={queryClient}>
        <McpToolPickerDialog
          gatewayId={overrides?.gatewayId ?? 'gw-1'}
          open
          onOpenChange={() => undefined}
          currentValue={overrides?.currentValue}
          onSelect={onSelect}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { onSelect };
}

describe('McpToolPickerDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('groups tools by namespace and renders the namespace count', async () => {
    renderPicker();
    await screen.findByTestId('mcp-tool-group-banking-customers');
    expect(
      screen.getByTestId('mcp-tool-group-banking-customers'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mcp-tool-group-banking-accounts'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mcp-tool-group-banking-operations'),
    ).toBeInTheDocument();
  });

  it('sorts namespaces alphabetically', async () => {
    renderPicker();
    await screen.findByTestId('mcp-tool-group-banking-customers');
    const body = screen.getByTestId('mcp-tool-picker-body');
    // Testing-library has no helper to query by testid prefix; fall back to direct DOM.
    /* eslint-disable testing-library/no-node-access */
    const groupHeaders = [
      ...body.querySelectorAll('[data-testid^="mcp-tool-group-"]'),
    ].map((el) => el.getAttribute('data-testid'));
    /* eslint-enable testing-library/no-node-access */
    expect(groupHeaders).toEqual([
      'mcp-tool-group-banking-accounts',
      'mcp-tool-group-banking-customers',
      'mcp-tool-group-banking-operations',
    ]);
  });

  it('filters groups and tools by search (matches description too)', async () => {
    renderPicker();
    await screen.findByTestId('mcp-tool-group-banking-customers');
    const search = screen.getByTestId('mcp-tool-picker-search');
    fireEvent.change(search, { target: { value: 'closure' } });
    await waitFor(() => {
      expect(
        screen.queryByTestId('mcp-tool-group-banking-customers'),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId('mcp-tool-group-banking-operations'),
    ).toBeInTheDocument();
  });

  it('shows empty state when search matches nothing', async () => {
    renderPicker();
    await screen.findByTestId('mcp-tool-group-banking-customers');
    const search = screen.getByTestId('mcp-tool-picker-search');
    fireEvent.change(search, { target: { value: 'xyznotfound' } });
    await waitFor(() => {
      expect(screen.getByText(/No tools match/i)).toBeInTheDocument();
    });
  });

  it('clicking a tool shows detail panel with description and input schema table', async () => {
    renderPicker();
    const toolButton = await screen.findByTestId(
      'mcp-tool-item-banking-customers/search_customer',
    );
    fireEvent.click(toolButton);
    const detail = screen.getByTestId('mcp-tool-picker-detail');
    expect(detail).toHaveTextContent(/Search customers by surname/);
    expect(detail).toHaveTextContent(/Parameter/);
    expect(detail).toHaveTextContent(/name/);
    expect(detail).toHaveTextContent(/Customer surname/);
  });

  it('Select button is disabled until a tool is selected', async () => {
    renderPicker();
    await screen.findByTestId('mcp-tool-group-banking-customers');
    const confirm = screen.getByTestId('mcp-tool-picker-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.click(
      screen.getByTestId('mcp-tool-item-banking-accounts/list_accounts'),
    );
    expect(confirm).toBeEnabled();
  });

  it('confirming selection calls onSelect with name and inputSchema', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    const toolButton = await screen.findByTestId(
      'mcp-tool-item-banking-accounts/list_accounts',
    );
    fireEvent.click(toolButton);
    fireEvent.click(screen.getByTestId('mcp-tool-picker-confirm'));
    expect(onSelect).toHaveBeenCalledWith(
      'banking-accounts/list_accounts',
      expect.objectContaining({ type: 'object' }),
    );
  });

  it('double-click on a tool commits immediately', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    const toolButton = await screen.findByTestId(
      'mcp-tool-item-banking-customers/search_customer',
    );
    fireEvent.doubleClick(toolButton);
    expect(onSelect).toHaveBeenCalledWith(
      'banking-customers/search_customer',
      expect.any(Object),
    );
  });

  it('renders "No input required" when schema has no properties', async () => {
    renderPicker();
    const toolButton = await screen.findByTestId(
      'mcp-tool-item-banking-operations/list_closure_reasons',
    );
    fireEvent.click(toolButton);
    const detail = screen.getByTestId('mcp-tool-picker-detail');
    expect(detail).toHaveTextContent(/No input required/);
  });

  it('orphaned currentValue (not in catalog) shows warning banner', async () => {
    renderPicker({ currentValue: 'legacy/removed_tool' });
    await screen.findByTestId('mcp-tool-group-banking-customers');
    expect(
      screen.getByText(/not available on this gateway/i),
    ).toBeInTheDocument();
  });

  it('shows empty-state message when catalog is empty', async () => {
    renderPicker({ tools: [] });
    await waitFor(() => {
      expect(
        screen.getByText(/No tools available on this gateway/i),
      ).toBeInTheDocument();
    });
  });

  it('tools without namespace prefix fall into the "misc" group', async () => {
    renderPicker({
      tools: [
        {
          name: 'ungrouped_tool',
          description: 'Legacy tool without namespace',
        },
      ],
    });
    await screen.findByTestId('mcp-tool-group-misc');
    expect(screen.getByTestId('mcp-tool-group-misc')).toBeInTheDocument();
  });

  it('empty namespace tools stay in the "misc" group list', async () => {
    renderPicker({
      tools: [
        { name: 'a', description: 'first' },
        { name: 'b', description: 'second' },
      ],
    });
    const group = await screen.findByTestId('mcp-tool-group-misc');
    expect(group).toHaveTextContent(/a/);
    expect(group).toHaveTextContent(/b/);
  });
});
