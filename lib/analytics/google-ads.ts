/**
 * Клиентские конверсии Google Ads (gtag). Базовый тег грузится в
 * components/ConsentScripts.tsx.
 *
 * ПОЧЕМУ ЭТОТ ФАЙЛ ПОЯВИЛСЯ
 * Раньше событие 'conversion' с меткой покупки уходило из двух мест сразу:
 *   1. ConsentScripts — на КАЖДОЙ загрузке страницы, включая 404;
 *   2. PreOrderModal — при отправке формы предзаказа.
 * В аккаунте Google Ads это дало 2 000 «конверсий» и коэффициент конверсии
 * 107,78% в кампании Sales-Search-7 — конверсий больше, чем кликов, что для
 * реальных заказов невозможно. Автостратегии на таких данных обучаются на
 * просмотры главной, а не на заказы.
 *
 * Теперь метка покупки живёт ровно в одном месте — на странице подтверждения
 * заказа, после того как заказ реально создан.
 *
 * ДЕДУПЛИКАЦИЯ
 * transaction_id — ключ на стороне Google: повторная отправка того же номера
 * заказа не удвоит конверсию, даже если клиент перезагрузит страницу
 * подтверждения или вернётся на неё по ссылке из истории. Плюс к этому вызов
 * закрыт guard'ом в sessionStorage — тем же приёмом, что и Meta Purchase.
 */

import { normalizeGermanPhone } from '../sms/phone';

/**
 * Действие-конверсия «Kauf». Один заказ — одно срабатывание.
 *
 * Создана 22.07.2026 в аккаунте 617-488-8286 специально взамен старой метки
 * (`wnsKCL2gwO8YEMrMvLQq`), на которой висят 2 000 фиктивных срабатываний от
 * бага с отправкой на каждой странице. Ту историю не очистить, и она мешала бы
 * обучению Smart Bidding — поэтому счёт начинается с нуля.
 *
 * Настройки в кабинете (менять там, не здесь):
 *   • категория: Покупка, главное действие (участвует в назначении ставок)
 *   • ценность: разная для каждой конверсии, источник — тег события
 *   • учёт: каждая (клиент может заказать дважды за один клик)
 *   • окно по кликам: 30 дней; атрибуция: на основе данных
 *   • расширенное отслеживание конверсий: включено
 *
 * Старую метку в кабинете стоит перевести во «второстепенные», чтобы её мусор
 * не участвовал в оптимизации. См. DUMBOS-GOOGLE-ADS-SETUP.md.
 */
export const GOOGLE_ADS_PURCHASE_LABEL = 'AW-11384333898/vRhYCL2izdQcEMrMvLQq';

/**
 * Отдельная метка для лида из формы предзаказа (PreOrderModal).
 *
 * Пустая строка = событие не отправляется. Раньше форма предзаказа слала метку
 * ПОКУПКИ — из-за этого заявка без оплаты считалась заказом. Создайте в Google
 * Ads отдельное действие-конверсию с типом «Lead» и впишите его метку сюда.
 */
export const GOOGLE_ADS_PREORDER_LEAD_LABEL = '';

/**
 * Действие-конверсия «Anruf – Website» (создано 22.07.2026).
 *
 * Считает НАЖАТИЯ на номер телефона, а не состоявшиеся разговоры. Часть будет
 * промахами и сбросами — это заложено в оценку ценности.
 *
 * Настройки в кабинете (менять там, не здесь):
 *   • категория: потенциальный клиент по телефону, главное действие
 *   • ценность: фиксированная €15. Это ОЦЕНКА: средний чек €30, но не каждое
 *     нажатие становится заказом. Занижено намеренно — недооценить безопаснее,
 *     ставки будут скорее недоинвестировать в звонковый трафик, чем наоборот.
 *     Пересмотреть, когда появится статистика «нажатия → реальные заказы».
 *   • учёт: одна конверсия на клик — несколько нажатий в одной сессии Google
 *     схлопнет сам, поэтому клиентский guard тут не нужен
 *   • окно по кликам: 30 дней; атрибуция: на основе данных
 *
 * Засчитывается только для посетителей, пришедших по рекламе.
 */
export const GOOGLE_ADS_PHONE_CALL_LABEL = 'AW-11384333898/jOnKCOPA_NQcEMrMvLQq';

/** Вешается на onClick у каждой tel:-ссылки (header, мобильное меню, footer). */
export function trackGoogleAdsPhoneCall(): void {
  if (typeof window === 'undefined' || !window.gtag) return;

  window.gtag('event', 'conversion', {
    send_to: GOOGLE_ADS_PHONE_CALL_LABEL,
  });
}

type PurchaseParams = {
  /** Сумма заказа. Уходит в Google как ценность конверсии — без неё нет ROAS. */
  value: number;
  /** Номер заказа. Ключ дедупликации. */
  transactionId: string;
  currency?: string;
  /** Enhanced Conversions, см. ниже. Необязательны — без них конверсия уйдёт как есть. */
  email?: string | null;
  phone?: string | null;
};

/**
 * Enhanced Conversions: email и телефон повышают долю конверсий, которые Google
 * сумеет связать с кликом. Особенно важно в ЕЭЗ — при `ad_storage: denied`
 * (наш дефолт в Consent Mode v2) куки недоступны, и без этих данных заметная
 * часть заказов останется неатрибутированной.
 *
 * Данные НЕ уходят в открытом виде: gtag хеширует их SHA-256 прямо в браузере
 * перед отправкой. Поэтому здесь передаётся plaintext — это документированный
 * Google способ для gtag.js, и серверный lib/conversions/hash-pii.ts тут не
 * подходит (он на node:crypto).
 *
 * Consent Mode остаётся главнее: при `ad_user_data: denied` Google эти данные
 * не использует, даже если они отправлены.
 *
 * ВАЖНО: одного кода мало. Enhanced Conversions нужно включить в интерфейсе
 * Google Ads (настройки действия-конверсии) и принять условия по данным
 * клиентов, иначе user_data просто игнорируется.
 */
function buildUserData(email?: string | null, phone?: string | null): Record<string, string> | null {
  const userData: Record<string, string> = {};

  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) userData.email = normalizedEmail;

  // Google требует E.164 (+49…). normalizeGermanPhone вернёт null на мусоре.
  const normalizedPhone = normalizeGermanPhone(phone ?? null);
  if (normalizedPhone) userData.phone_number = normalizedPhone;

  return Object.keys(userData).length > 0 ? userData : null;
}

export function trackGoogleAdsPurchase({
  value,
  transactionId,
  currency = 'EUR',
  email,
  phone,
}: PurchaseParams): void {
  if (typeof window === 'undefined' || !window.gtag) return;

  const userData = buildUserData(email, phone);
  if (userData) window.gtag('set', 'user_data', userData);

  window.gtag('event', 'conversion', {
    send_to: GOOGLE_ADS_PURCHASE_LABEL,
    value,
    currency,
    transaction_id: transactionId,
  });
}

export function trackGoogleAdsPreOrderLead(): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  if (!GOOGLE_ADS_PREORDER_LEAD_LABEL) return;

  window.gtag('event', 'conversion', {
    send_to: GOOGLE_ADS_PREORDER_LEAD_LABEL,
  });
}
