import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Иерархия скидок: Code > Treuepunkte > Angebot.
 *  - активен код → баллы вообще недоступны (объясняем, а не прячем);
 *  - доступна денежная акция → списание баллов вытеснит её, поэтому спрашиваем.
 */

import LoyaltyRedeem from '../LoyaltyRedeem';

const t = (_k: string, fb?: string) => fb || _k;

const RULES = { redeemMaxShare: 0.3, minOrderToRedeem: 10, pointValueEuro: 1 };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, loyalty: { balance: 20 }, rules: RULES }),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWidget(props: any = {}) {
  return render(
    <LoyaltyRedeem
      orderAmountBeforePoints={props.orderAmountBeforePoints ?? 20}
      appliedPoints={props.appliedPoints ?? 0}
      onChange={props.onChange || vi.fn()}
      codeActive={props.codeActive}
      activeCode={props.activeCode}
      angebotAvailable={props.angebotAvailable}
      angebotName={props.angebotName}
      t={t}
    />
  );
}

async function applyPoints(value: string) {
  const input = await screen.findByPlaceholderText(/^max\./);
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByText('Einlösen'));
}

describe('LoyaltyRedeem — конфликты скидок', () => {
  it('без акции баллы применяются сразу', async () => {
    const onChange = vi.fn();
    renderWidget({ onChange });
    await applyPoints('5');
    expect(onChange).toHaveBeenCalledWith(5);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('доступна денежная акция → сначала диалог «Angebot oder Treuepunkte?»', async () => {
    const onChange = vi.fn();
    renderWidget({ onChange, angebotAvailable: true, angebotName: '2+1 Pizza' });
    await applyPoints('5');

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Angebot oder Treuepunkte?')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('«Angebot behalten» → баллы не списываются', async () => {
    const onChange = vi.fn();
    renderWidget({ onChange, angebotAvailable: true });
    await applyPoints('5');

    fireEvent.click(screen.getByText('Angebot behalten'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Punkte einlösen» → баллы списываются (акцию подавит CartContext)', async () => {
    const onChange = vi.fn();
    renderWidget({ onChange, angebotAvailable: true });
    await applyPoints('5');

    fireEvent.click(screen.getByText('Punkte einlösen'));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('баллы применены + есть акция → объясняем, что акция подавлена', async () => {
    renderWidget({ appliedPoints: 5, angebotAvailable: true });
    expect(
      await screen.findByText(/Angebote sind mit Punkten nicht kombinierbar/)
    ).toBeTruthy();
  });

  it('активен код → поля ввода нет, есть объяснение', async () => {
    const onChange = vi.fn();
    renderWidget({ onChange, codeActive: true, activeCode: 'TEAM' });
    await waitFor(() =>
      expect(
        screen.getByText(/nicht zusammen mit einem Gutscheincode eingelöst werden/)
      ).toBeTruthy()
    );
    expect(screen.queryByPlaceholderText(/^max\./)).toBeNull();
    expect(screen.getByText('(TEAM)')).toBeTruthy();
  });
});
