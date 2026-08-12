/**
 * Типы AI-оценки времени заказа (изготовление + доставка).
 * Файл без зависимостей: его импортируют и схема БД, и telegram, и сам движок.
 */

export type EtaLoadLevel = 'normal' | 'busy' | 'peak';

/** Станция кухни, на которой готовится позиция. */
export type KitchenStation = 'pizza' | 'fryer' | 'sushi' | 'none';

/**
 * Персонал на смене — меняется селекторами в панели AI-плана кухни
 * (настройка kitchenStaffing, см. KITCHEN_STAFFING_KEY в order-eta.ts).
 * Влияет и на оценку времени заказа, и на план кухни.
 */
export interface KitchenStaffing {
  /** Поваров на пицце (1…4): двое делают две пиццы параллельно. */
  pizzaCooks: number;
  /** Помощников на фритюре/Beilagen (0…3): 0 — гарнир делает сам повар (последовательно с пиццей). */
  fryerHelpers: number;
  /** Людей на суши-станции MakiLove (1…4). */
  sushiChefs: number;
}

/**
 * Один шаг плана кухни: какие заказы готовить (вместе) и каким рейсом везти.
 */
export interface KitchenPlanBatch {
  /** Порядковый номер шага (1 = делать первым). */
  step: number;
  /** Номера заказов этого шага. */
  orderNumbers: string[];
  /** Город/направление рейса («Oerlenbach», «Bad Kissingen Zentrum»…), для самовывоза — «Abholung». */
  area: string;
  /** true — заказы шага готовить одновременно (поедут одним курьером). */
  cookTogether: boolean;
  /** Описание рейса курьера по-русски («рейс №1: Oerlenbach, 2 адреса»), null для самовывоза. */
  courier: string | null;
  /** Почему именно так (по-русски, коротко). */
  rationale: string;
}

export interface KitchenPlan {
  batches: KitchenPlanBatch[];
  /** Итог для персонала по-русски (1-2 предложения). */
  summary: string;
  /** Рекомендация при перегрузе (стоп-бот, сдвиг обещаний), null когда всё ок. */
  advisory: string | null;
  loadLevel: EtaLoadLevel;
  source: 'ai' | 'heuristic';
  model?: string;
  /** Сколько активных заказов анализировалось. */
  queueSize: number;
  /** Заказы уже в пути (курьер занят) — в шаги не входят. */
  onTheRoad: string[];
  /** Когда план построен (ISO). */
  generatedAt: string;
}

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
