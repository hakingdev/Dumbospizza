import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyScheduleEditor } from '../weekly-schedule-editor';
import {
  resolveWeeklySchedule,
  validateWeeklySchedule,
  type WeeklySchedule,
} from '../../../lib/opening-schedule';

/** Обёртка с состоянием: редактор контролируемый, как в «Заведении». */
function Harness({ onState }: { onState: (s: WeeklySchedule) => void }) {
  const [schedule, setSchedule] = useState(() =>
    resolveWeeklySchedule({ ordersStartHour: '17:00', ordersEndHour: '22:00' })
  );
  return (
    <WeeklyScheduleEditor
      value={schedule}
      onChange={(next) => {
        setSchedule(next);
        onState(next);
      }}
      errors={validateWeeklySchedule(schedule).errors}
    />
  );
}

describe('WeeklyScheduleEditor — график приёма по дням', () => {
  it('выходной день и обратно — интервалы возвращаются', () => {
    const onState = vi.fn();
    render(<Harness onState={onState} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Вторник: сделать выходным' }));
    expect(onState.mock.lastCall?.[0].tue).toEqual([]);
    expect(screen.getByText('Выходной — заказы не принимаем')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Вторник: рабочий день' }));
    expect(onState.mock.lastCall?.[0].tue).toEqual([{ start: '17:00', end: '22:00' }]);
  });

  it('второй интервал дня: утро + вечер', () => {
    const onState = vi.fn();
    render(<Harness onState={onState} />);
    const start = screen.getByLabelText('Понедельник, интервал 1: начало');
    const end = screen.getByLabelText('Понедельник, интервал 1: конец');
    fireEvent.change(start, { target: { value: '10:00' } });
    fireEvent.change(end, { target: { value: '14:00' } });
    fireEvent.click(screen.getAllByRole('button', { name: '+ Добавить интервал' })[0]);
    fireEvent.change(screen.getByLabelText('Понедельник, интервал 2: начало'), { target: { value: '17:00' } });
    fireEvent.change(screen.getByLabelText('Понедельник, интервал 2: конец'), { target: { value: '21:00' } });
    expect(onState.mock.lastCall?.[0].mon).toEqual([
      { start: '10:00', end: '14:00' },
      { start: '17:00', end: '21:00' },
    ]);
    // Остальные дни не задеты.
    expect(onState.mock.lastCall?.[0].sat).toEqual([{ start: '17:00', end: '22:00' }]);
  });

  it('пересечение интервалов подсвечивается ошибкой', () => {
    render(<Harness onState={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Добавить интервал' })[0]);
    fireEvent.change(screen.getByLabelText('Понедельник, интервал 2: начало'), { target: { value: '20:00' } });
    expect(screen.getByText('Интервалы пересекаются')).toBeTruthy();
  });

  it('«На все дни» копирует часы дня на неделю после подтверждения', () => {
    const onState = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Harness onState={onState} />);
    fireEvent.change(screen.getByLabelText('Среда, интервал 1: конец'), { target: { value: '23:00' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'На все дни' })[2]);
    const last = onState.mock.lastCall?.[0] as WeeklySchedule;
    expect(Object.values(last).every((ranges) => ranges[0].end === '23:00')).toBe(true);
  });
});
