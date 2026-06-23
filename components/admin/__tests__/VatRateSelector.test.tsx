import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VatRateSelector from '../VatRateSelector';

describe('VatRateSelector — тулбар выбора ставки НДС в карточке товара', () => {
  it('рендерит кнопки 7 % и 19 %', () => {
    render(<VatRateSelector value={0.07} onChange={() => {}} />);
    expect(screen.getByTestId('vat-rate-7')).toBeTruthy();
    expect(screen.getByTestId('vat-rate-19')).toBeTruthy();
  });

  it('подсвечивает активную ставку (aria-pressed)', () => {
    render(<VatRateSelector value={0.19} onChange={() => {}} />);
    expect(screen.getByTestId('vat-rate-19').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('vat-rate-7').getAttribute('aria-pressed')).toBe('false');
  });

  it('по умолчанию (без value) активна ставка 7 %', () => {
    render(<VatRateSelector onChange={() => {}} />);
    expect(screen.getByTestId('vat-rate-7').getAttribute('aria-pressed')).toBe('true');
  });

  it('клик по 19 % вызывает onChange(0.19)', () => {
    const onChange = vi.fn();
    render(<VatRateSelector value={0.07} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('vat-rate-19'));
    expect(onChange).toHaveBeenCalledWith(0.19);
  });

  it('клик по 7 % вызывает onChange(0.07)', () => {
    const onChange = vi.fn();
    render(<VatRateSelector value={0.19} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('vat-rate-7'));
    expect(onChange).toHaveBeenCalledWith(0.07);
  });
});
