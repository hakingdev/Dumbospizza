'use client';

/**
 * Отзывы (канва D6 / 07). Полностью демо: своей системы отзывов нет,
 * источник (Google / Lieferando) ещё не подключён.
 */

import { useState } from 'react';
import {
  Card,
  DemoTag,
  FilterChip,
  SectionLabel,
  btnGhost,
  btnPrimary,
  btnSoft,
} from '../../../components/admin-v2/ui';

/* Гистограмма из канвы: 3★+ — брендовый, 1–2★ — красный */
const RATING_ROWS = [
  { stars: 5, percent: 82, count: 179, color: '#8A6C4C' },
  { stars: 4, percent: 12, count: 26, color: '#8A6C4C' },
  { stars: 3, percent: 4, count: 8, color: '#8A6C4C' },
  { stars: 2, percent: 2, count: 4, color: '#D42A47' },
  { stars: 1, percent: 1, count: 1, color: '#D42A47' },
];

const PRAISE_CHIPS = ['Frische Zutaten · 64', 'Pünktlich · 41', 'Sushi · 22'];

const REVIEWS = [
  {
    name: 'Markus H.',
    stars: 2,
    unanswered: true,
    meta: 'Вчера, 20:14 · заказ #1021',
    text: '«Pizza kalt angekommen, Lieferung hat über eine Stunde gedauert. Der Teig war trotzdem gut.»',
    reply: null,
  },
  {
    name: 'Sabine K.',
    stars: 5,
    unanswered: false,
    meta: '08.08, 19:02 · заказ #1002',
    text: '«Beste Pizza in der Stadt, immer frisch und pünktlich. Die Cheese Bombs sind ein Traum.»',
    reply: {
      meta: 'Ваш ответ · 08.08, 21:40',
      text: '«Vielen Dank, Sabine! Wir freuen uns auf Ihre nächste Bestellung.»',
    },
  },
  {
    name: 'Jonas K.',
    stars: 4,
    unanswered: false,
    meta: '07.08, 18:31 · заказ #0988',
    text: '«Alles gut, nur die Sushi-Auswahl könnte größer sein.»',
    reply: null,
  },
];

const DEMO_TITLE = 'Заработает после подключения источника отзывов';

/** Звёзды в цвете accent-hit (#713F12), размер задаётся className. */
function Stars({ n, className = 'text-base font-bold leading-6' }: { n: number; className?: string }) {
  return (
    <span className={`${className} text-[#713F12]`}>
      {'★'.repeat(n)}
      {'☆'.repeat(5 - n)}
    </span>
  );
}

export default function ReviewsPage() {
  const [tab, setTab] = useState<'all' | 'unanswered' | 'replied'>('all');
  const unansweredCount = REVIEWS.filter((review) => review.unanswered).length;
  const visible = REVIEWS.filter((review) =>
    tab === 'all' ? true : tab === 'unanswered' ? review.unanswered : !!review.reply
  );

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 flex items-center gap-3 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Отзывы <DemoTag />
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            218 отзывов · 3 без ответа · среднее время ответа 4 ч
          </p>
        </div>
        <button
          type="button"
          disabled
          title={DEMO_TITLE}
          className={`${btnPrimary} hidden h-12 min-w-[96px] px-6 text-lg lg:inline-flex`}
        >
          Ответить на 3 отзыва
        </button>
      </div>

      <div className="rounded-2xl border border-[#EBE0CE] bg-[#FAF7F2] p-4 text-sm leading-5 text-gray-600">
        Макет раздела: собственной системы отзывов на сайте пока нет. Нужно решить, откуда собирать
        отзывы (Google Business, Lieferando, свои после заказа) — тогда экран оживёт.
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[360px_1fr] lg:gap-6">
        <div className="flex flex-col gap-4 lg:gap-6">
          {/* Средний рейтинг */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <SectionLabel>Средний рейтинг</SectionLabel>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-extrabold leading-10 tracking-[-.02em] text-gray-900 tabular-nums">
                4,8
              </span>
              <Stars n={5} className="min-w-0 flex-1 text-xl font-extrabold leading-6 tracking-[-.01em]" />
              <span className="flex-none text-base font-bold leading-6 text-[#15803D]">↑ 0,2</span>
            </div>
            {RATING_ROWS.map((row) => (
              <div key={row.stars} className="flex items-center gap-2">
                <span className="w-3.5 flex-none text-sm font-bold leading-5 text-gray-600">
                  {row.stars}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-gray-100">
                  <span
                    className="block h-2 rounded"
                    style={{ width: `${row.percent}%`, background: row.color }}
                  />
                </span>
                <span className="w-[34px] flex-none text-right text-sm leading-5 text-gray-600 tabular-nums">
                  {row.count}
                </span>
              </div>
            ))}
          </Card>

          {/* Хвалят */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <SectionLabel>Чаще всего хвалят</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {PRAISE_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex h-8 items-center rounded-full border border-gray-200 bg-white px-3.5 text-sm font-bold leading-5 text-gray-900"
                >
                  {chip}
                </span>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {/* Фильтры */}
          <div className="flex items-center gap-2">
            <FilterChip label="Все" active={tab === 'all'} onClick={() => setTab('all')} />
            <FilterChip
              label="Без ответа"
              count={unansweredCount}
              active={tab === 'unanswered'}
              onClick={() => setTab('unanswered')}
            />
            <FilterChip label="Ответы" active={tab === 'replied'} onClick={() => setTab('replied')} />
          </div>

          {visible.map((review) => (
            <div
              key={review.name}
              className={`flex flex-col gap-3 overflow-hidden rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(17,24,39,.04),0_2px_8px_rgba(17,24,39,.06)] lg:p-6 ${
                review.unanswered ? 'border-[#D42A47]' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="flex-none text-lg font-bold leading-6 text-gray-900">
                  {review.name}
                </span>
                <Stars n={review.stars} className="min-w-0 flex-1 text-base font-bold leading-6" />
                {review.unanswered && (
                  <span className="inline-flex h-6 flex-none items-center rounded-full bg-[#FDE6E7] px-2.5 text-xs font-bold leading-4 text-[#B31F39]">
                    Без ответа
                  </span>
                )}
              </div>
              <span className="text-xs leading-4 text-gray-600">{review.meta}</span>
              <p className="m-0 text-base leading-6 text-gray-900">{review.text}</p>
              {review.reply && (
                <div className="flex flex-col gap-1 rounded-xl bg-[#FAF7F2] px-4 py-3">
                  <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-[#8A6C4C]">
                    {review.reply.meta}
                  </span>
                  <p className="m-0 text-sm leading-5 text-gray-900">{review.reply.text}</p>
                </div>
              )}
              {review.unanswered && (
                <>
                  <textarea
                    disabled
                    title={DEMO_TITLE}
                    placeholder="Напишите ответ клиенту…"
                    className="min-h-[96px] w-full resize-y rounded-xl border border-gray-300 bg-white px-4 py-3 font-sans text-base leading-6 text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-[#8A6C4C] disabled:cursor-not-allowed"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled
                      title={DEMO_TITLE}
                      className={`${btnPrimary} h-10 min-w-[96px] px-4 text-base`}
                    >
                      Отправить ответ
                    </button>
                    <button
                      type="button"
                      disabled
                      title={DEMO_TITLE}
                      className={`${btnSoft} h-10 min-w-[96px] px-4 text-base`}
                    >
                      Шаблон извинения
                    </button>
                    <div className="hidden flex-1 lg:block" />
                    <button
                      type="button"
                      disabled
                      title="Демо-отзыв — заказ существует только в макете"
                      className={`${btnGhost} h-10 min-w-[96px] px-4 text-base`}
                    >
                      Открыть заказ
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
