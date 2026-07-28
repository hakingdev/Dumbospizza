import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromoConflictDialog, { PROMO_CONFLICT_MESSAGE } from '../PromoConflictDialog';

/** AC #6: при конфликте пользователь видит выбор между Angebot и Coupon. */
describe('PromoConflictDialog', () => {
  it('не рендерится, когда закрыт', () => {
    render(
      <PromoConflictDialog open={false} onKeep={() => {}} onApply={() => {}} />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('показывает текст ТЗ и обе кнопки выбора', () => {
    render(
      <PromoConflictDialog open onKeep={() => {}} onApply={() => {}} />
    );
    expect(screen.getByText(PROMO_CONFLICT_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Angebot behalten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promo-Code anwenden' })).toBeInTheDocument();
  });

  it('«Angebot behalten» вызывает onKeep', async () => {
    const onKeep = vi.fn();
    const onApply = vi.fn();
    render(<PromoConflictDialog open onKeep={onKeep} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Angebot behalten' }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('«Promo-Code anwenden» вызывает onApply', async () => {
    const onKeep = vi.fn();
    const onApply = vi.fn();
    render(<PromoConflictDialog open onKeep={onKeep} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Promo-Code anwenden' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
  });
});
