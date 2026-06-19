/**
 * Мгновенный скелетон для страницы акции (force-dynamic + запрос в БД).
 * Без него навигация по «Zum Angebot» «замирает» без обратной связи — кажется,
 * что клик не сработал. Next показывает этот loading сразу при переходе.
 */
export default function AngebotLoading() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl animate-pulse" aria-busy="true">
      <div className="h-4 w-28 rounded bg-gray-200 mb-4" />
      <div className="h-7 w-24 rounded bg-gray-200 mb-4" />
      <div className="h-9 w-2/3 rounded bg-gray-200 mb-4" />
      <div className="h-4 w-1/2 rounded bg-gray-200 mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4 border rounded-lg p-3">
            <div className="h-20 w-20 shrink-0 rounded-md bg-gray-200" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="h-4 w-1/3 rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
