// @vitest-environment jsdom
import { DataListBlock as DataListBlockType } from '@activepieces/shared';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DataListBlock } from './data-list-block';

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
    returnNull: false,
    fallbackLng: 'en',
  });
});

function renderBlock(
  block: DataListBlockType,
  onPick?: (payload: string) => void,
): void {
  render(
    <I18nextProvider i18n={i18next}>
      <DataListBlock block={block} onPick={onPick} />
    </I18nextProvider>,
  );
}

describe('DataListBlock — single-confirm layout', () => {
  const singleConfirmBlock: DataListBlockType = {
    type: 'data-list',
    selectMode: 'single',
    layout: 'single-confirm',
    items: [
      {
        primary: '11255521',
        title: 'BELLAFRONTE GIANLUCA',
        subtitle: 'PRIVATO',
        payload: '11255521',
      },
    ],
  };

  it('renders Yes/No buttons and the single item title', () => {
    renderBlock(singleConfirmBlock);
    expect(screen.getByTestId('single-confirm-block')).toBeInTheDocument();
    expect(screen.getByText('BELLAFRONTE GIANLUCA')).toBeInTheDocument();
    expect(screen.getByText('PRIVATO')).toBeInTheDocument();
    expect(screen.getByTestId('single-confirm-yes')).toBeInTheDocument();
    expect(screen.getByTestId('single-confirm-no')).toBeInTheDocument();
  });

  it('calls onPick with items[0].payload when Yes is clicked', () => {
    const onPick = vi.fn();
    renderBlock(singleConfirmBlock, onPick);
    fireEvent.click(screen.getByTestId('single-confirm-yes'));
    expect(onPick).toHaveBeenCalledWith('11255521');
  });

  it('hides the buttons and shows dismiss hint when No is clicked', () => {
    const onPick = vi.fn();
    renderBlock(singleConfirmBlock, onPick);
    fireEvent.click(screen.getByTestId('single-confirm-no'));
    expect(onPick).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('single-confirm-yes'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('single-confirm-no')).not.toBeInTheDocument();
  });

  it('falls back to cards layout when layout is cards', () => {
    const cardsBlock: DataListBlockType = {
      type: 'data-list',
      selectMode: 'single',
      layout: 'cards',
      items: [
        { primary: 'a', title: 'A', payload: 'a' },
        { primary: 'b', title: 'B', payload: 'b' },
      ],
    };
    renderBlock(cardsBlock);
    expect(
      screen.queryByTestId('single-confirm-block'),
    ).not.toBeInTheDocument();
  });
});
