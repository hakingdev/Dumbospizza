'use client';

/** Что нового — заглушка (в дизайне раздел есть только в навигации). */

import { ComingSoon } from '../../../components/admin-v2/ui';

export default function NewsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
          Что нового
        </h1>
        <p className="m-0 text-base leading-6 text-gray-600">Обновления · дорожная карта</p>
      </div>
      <ComingSoon note="Лента обновлений портала и план развития. Первая запись появится после запуска новой админки." />
    </div>
  );
}
