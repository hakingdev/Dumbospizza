/**
 * Типы AI-оценки времени заказа (изготовление + доставка).
 * Файл без зависимостей: его импортируют и схема БД, и telegram, и сам движок.
 */

export type EtaLoadLevel = 'normal' | 'busy' | 'peak';

/** Станция кухни, на которой готовится позиция. */
export type KitchenStation = 'pizza' | 'fryer' | 'sushi' | 'none';

export interface OrderEtaAnalysis {
  /** Обещанное клиенту время от текущего момента, мин (готовка + доставка). */
  etaMinutes: number;
  /** Изготовление с учётом очереди, мин. */
  prepMinutes: number;
  /** Доставка, мин (0 для самовывоза). */
  deliveryMinutes: number;
  /** Дорожное расстояние до адреса, км. */
  distanceKm?: number;
  /** Оценка времени в пути в одну сторону, мин. */
  driveMinutes?: number;
  loadLevel: EtaLoadLevel;
  /** Рекомендация персоналу (пауза приёма / сдвиг обещаний), по-русски. */
  advisory: string | null;
  /** Подсказка по маршруту (с каким заказом объединить), по-русски. */
  routeHint: string | null;
  /** Короткое обоснование расчёта. */
  reasoning?: string;
  source: 'ai' | 'heuristic';
  model?: string;
  /** Сколько активных заказов было в очереди на момент оценки. */
  queueSize?: number;
  coordinates?: { lat: number; lng: number };
}
