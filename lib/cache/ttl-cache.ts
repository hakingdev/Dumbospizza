/**
 * Мини-кэш «значение живёт N миллисекунд» для горячих справочников, которые
 * читаются на КАЖДЫЙ публичный запрос и меняются раз в день: список акций,
 * библиотека размеров, флаг Mews POS, категории.
 *
 * Живёт в памяти инстанса функции (как и пул в lib/db/client.ts). При всплеске
 * трафика Vercel поднимает десятки инстансов, у каждого кэш свой — это нормально:
 * цель не «один запрос на весь мир», а «один запрос на инстанс в TTL» вместо
 * одного запроса на каждый HTTP-вызов.
 *
 * Кэш schemas-справочников ОБЯЗАН инвалидироваться из админских мутаций
 * (invalidate()), иначе редактор увидит свои правки только через TTL.
 */
export type TtlCache<T> = {
  get(): Promise<T>;
  invalidate(): void;
};

export function createTtlCache<T>(load: () => Promise<T>, ttlMs: number): TtlCache<T> {
  let value: T | undefined;
  let expiresAt = 0;
  // Параллельные запросы к холодному кэшу не должны бить в БД по разу каждый:
  // первый заводит промис, остальные ждут его же.
  let inflight: Promise<T> | null = null;

  return {
    get(): Promise<T> {
      if (value !== undefined && Date.now() < expiresAt) {
        return Promise.resolve(value);
      }
      if (!inflight) {
        inflight = load()
          .then((fresh) => {
            value = fresh;
            expiresAt = Date.now() + ttlMs;
            return fresh;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    invalidate() {
      value = undefined;
      expiresAt = 0;
    },
  };
}
