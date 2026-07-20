import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeekdayPicker } from '../page';

/** Кнопка дня по подписи (Пн/Вт/…). */
function day(label: string) {
  return screen.getByRole('button', { name: label });
}

describe('WeekdayPicker', () => {
  it('подсвечивает выбранные дни через aria-pressed', () => {
    render(<WeekdayPicker value={[1, 2]} onChange={() => {}} />);

    expect(day('Пн')).toHaveAttribute('aria-pressed', 'true');
    expect(day('Вт')).toHaveAttribute('aria-pressed', 'true');
    expect(day('Ср')).toHaveAttribute('aria-pressed', 'false');
    expect(day('Вс')).toHaveAttribute('aria-pressed', 'false');
  });

  it('показывает дни с понедельника, воскресенье последним', () => {
    render(<WeekdayPicker value={[]} onChange={() => {}} />);

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t && t.length <= 2);
    expect(labels).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
  });

  it('добавляет день кликом и отдаёт список отсортированным', () => {
    const onChange = vi.fn();
    render(<WeekdayPicker value={[2]} onChange={onChange} />);

    fireEvent.click(day('Пн'));
    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it('снимает уже выбранный день повторным кликом', () => {
    const onChange = vi.fn();
    render(<WeekdayPicker value={[1, 2]} onChange={onChange} />);

    fireEvent.click(day('Вт'));
    expect(onChange).toHaveBeenCalledWith([1]);
  });

  it('кнопка «каждый день» возвращает всю неделю и прячется, когда выбрано всё', () => {
    const onChange = vi.fn();
    const { rerender } = render(<WeekdayPicker value={[1]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'каждый день' }));
    expect(onChange).toHaveBeenCalledWith([0, 1, 2, 3, 4, 5, 6]);

    rerender(<WeekdayPicker value={[0, 1, 2, 3, 4, 5, 6]} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'каждый день' })).toBeNull();
  });

  it('объясняет расписание словами, а не только подсветкой', () => {
    const { rerender } = render(<WeekdayPicker value={[0, 1, 2, 3, 4, 5, 6]} onChange={() => {}} />);
    expect(screen.getByText('Показывается каждый день')).toBeInTheDocument();

    rerender(<WeekdayPicker value={[1, 2]} onChange={() => {}} />);
    expect(screen.getByText(/Только Пн, Вт/)).toBeInTheDocument();
  });

  it('предупреждает, что пустой выбор значит «каждый день», а не «никогда»', () => {
    render(<WeekdayPicker value={[]} onChange={() => {}} />);
    expect(
      screen.getByText('Ничего не выбрано — баннер будет показываться каждый день')
    ).toBeInTheDocument();
  });
});
