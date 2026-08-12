'use client';

/** Помощь — заглушка (в дизайне раздел есть только в навигации). */

import { ComingSoon } from '../../../components/admin-v2/ui';

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
          Помощь
        </h1>
        <p className="m-0 text-base leading-6 text-gray-600">База знаний · поддержка</p>
      </div>
      <ComingSoon note="Здесь появятся база знаний по порталу и форма обращения в поддержку. Пока по всем вопросам — напрямую разработчику." />
    </div>
  );
}
