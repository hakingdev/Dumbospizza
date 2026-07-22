/**
 * Единая точка правды по согласию на cookies (TDDDG §25, DSGVO Art. 6 Abs. 1 lit. a).
 *
 * Правило: до явного «да» на странице не должно появиться НИ ОДНОГО
 * маркетингового/аналитического cookie. Раньше баннер только писал ответ в
 * localStorage, а _ga/_fbp/_ttp ставились ещё до клика — это классическая
 * зона Abmahnung. Теперь:
 *
 *   • Meta- и TikTok-пиксели вообще не грузятся, пока нет согласия на marketing;
 *   • Google-тег грузится сразу, но в режиме Consent Mode v2 «denied» — он не
 *     пишет cookies, зато шлёт cookieless-пинги, без которых в ЕЭЗ не работают
 *     моделирование конверсий и ремаркетинг (см. GOOGLE_TAG_MODE);
 *   • при отзыве согласия зовём consent-API вендоров и стираем уже
 *     поставленные cookies (Art. 7 Abs. 3 DSGVO — отозвать так же легко, как дать).
 *
 * Модуль импортируется и сервером (за строкой бутстрапа), и клиентом,
 * поэтому на верхнем уровне не должно быть обращений к window.
 */

import { storageGet, storageSet } from './safe-storage';

/**
 * Как грузить Google-тег до решения пользователя:
 *
 *   'advanced' — тег грузится всегда, состояние по умолчанию denied. Cookies не
 *                ставятся, но Google получает cookieless-пинги → работают
 *                модельные конверсии и ремаркетинг в ЕЭЗ. Так работает
 *                большинство CMP; это документированный Google способ.
 *   'basic'    — тег не грузится вообще, пока нет согласия. Максимально
 *                консервативно юридически (к Google не уходит даже IP),
 *                но моделирования конверсий не будет.
 *
 * Это единственное место, где решение спорное. Если юрист скажет «никаких
 * запросов к Google без согласия» — переключите на 'basic', остальное само.
 */
export const GOOGLE_TAG_MODE: 'advanced' | 'basic' = 'advanced';

export const CONSENT_STORAGE_KEY = 'cookie-consent';

/**
 * Версия текста согласия. Бампайте, когда меняется состав вендоров или
 * формулировка баннера — старое согласие перестанет считаться действительным
 * и баннер спросит заново.
 *
 * v2: добавлены категории analytics/marketing. Легаси-значения 'accepted' /
 * 'declined' от v1 НЕ мигрируем: старый баннер не называл ни рекламу, ни
 * третьи стороны (Meta, TikTok, Google Ads), поэтому информированным согласием
 * на маркетинг он не был.
 */
export const CONSENT_VERSION = 2;

/** Событие, которым футер (и любая другая кнопка) переоткрывает настройки. */
export const CONSENT_SETTINGS_EVENT = 'dumbos:open-consent-settings';

export type ConsentDecision = {
  version: number;
  /** GA4: измерение посещаемости. */
  analytics: boolean;
  /** Google Ads, Meta Pixel, TikTok Pixel: реклама и ремаркетинг. */
  marketing: boolean;
  /** Момент согласия — Nachweispflicht, Art. 7 Abs. 1 DSGVO. */
  decidedAt: string;
};

export const DENY_ALL = { analytics: false, marketing: false } as const;
export const GRANT_ALL = { analytics: true, marketing: true } as const;

/**
 * Копия решения в памяти: на iOS с «Alle Cookies blockieren» localStorage
 * недоступен целиком (см. lib/safe-storage). Тогда согласие живёт до
 * перезагрузки — баннер не должен всплывать после каждого клика.
 */
let memoryDecision: ConsentDecision | null = null;

type Listener = (decision: ConsentDecision | null) => void;
const listeners = new Set<Listener>();

function parseDecision(raw: string | null): ConsentDecision | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== CONSENT_VERSION) return null;
    return {
      version: CONSENT_VERSION,
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      decidedAt: typeof parsed.decidedAt === 'string' ? parsed.decidedAt : '',
    };
  } catch {
    // Легаси-строка 'accepted'/'declined' или мусор — согласия нет.
    return null;
  }
}

/** @returns null, если решения ещё нет (или оно устарело) — тогда всё denied. */
export function readConsent(): ConsentDecision | null {
  if (memoryDecision) return memoryDecision;
  if (typeof window === 'undefined') return null;
  // Прямое обращение к localStorage может БРОСИТЬ на iOS — только через хелпер.
  const decision = parseDecision(storageGet(CONSENT_STORAGE_KEY));
  memoryDecision = decision;
  return decision;
}

/** Записывает решение, шлёт сигналы вендорам и будит подписчиков. */
export function writeConsent(choice: { analytics: boolean; marketing: boolean }): ConsentDecision {
  const previous = readConsent();
  const decision: ConsentDecision = {
    version: CONSENT_VERSION,
    analytics: choice.analytics,
    marketing: choice.marketing,
    decidedAt: new Date().toISOString(),
  };

  memoryDecision = decision;
  if (typeof window !== 'undefined') {
    storageSet(CONSENT_STORAGE_KEY, JSON.stringify(decision));
    applyConsent(decision, previous);
  }

  listeners.forEach((listener) => listener(decision));
  return decision;
}

/** @returns функция отписки. */
export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openConsentSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_SETTINGS_EVENT));
}

/** Только для тестов: сбрасывает кэш в памяти между кейсами. */
export function resetConsentCacheForTests(): void {
  memoryDecision = null;
}

/**
 * Перезагрузка вынесена в объект, чтобы тесты могли её подменить: в jsdom
 * навигация не реализована.
 */
export const pageReloader = {
  reload: () => window.location.reload(),
};

// ---------------------------------------------------------------------------
// Сигналы вендорам
// ---------------------------------------------------------------------------

/**
 * Consent Mode v2. Обязательны все четыре ключа: без ad_user_data и
 * ad_personalization Google с марта 2024 не отдаёт ремаркетинг в ЕЭЗ.
 * ВАЖНО: тот же маппинг продублирован в consentBootstrapScript() —
 * правьте оба места.
 */
function googleSignals(decision: ConsentDecision) {
  const marketing = decision.marketing ? 'granted' : 'denied';
  return {
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
    personalization_storage: marketing,
    analytics_storage: decision.analytics ? 'granted' : 'denied',
  };
}

function applyConsent(decision: ConsentDecision, previous: ConsentDecision | null): void {
  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', googleSignals(decision));
    // Пока рекламного согласия нет — режем ad-click-идентификаторы в пингах.
    window.gtag('set', 'ads_data_redaction', !decision.marketing);
  }

  // Пиксели загружены только при marketing=true, но при отзыве SDK остаётся в
  // памяти страницы — глушим его штатным consent-API вендора.
  if (typeof window.fbq === 'function') {
    window.fbq('consent', decision.marketing ? 'grant' : 'revoke');
  }
  if (window.ttq) {
    if (decision.marketing) window.ttq.grantConsent?.();
    else window.ttq.holdConsent?.();
  }

  const withdrew =
    (previous?.analytics && !decision.analytics) || (previous?.marketing && !decision.marketing);
  if (withdrew) clearTrackingCookies();

  // ИЗМЕНЕНИЕ решения (не первое) требует перезагрузки, в обе стороны:
  //
  //   • отзыв: fbq('consent','revoke') глушит отправку, но SDK остаётся в
  //     памяти страницы и продолжает СОБИРАТЬ — проверено, после revoke он
  //     ловил клики (SubscribedButtonClick с текстом кнопки) и придержал их
  //     в очереди до следующего grant;
  //   • повторное согласие: next/script помнит уже выполненные скрипты по id
  //     (LoadCache), поэтому сниппет пикселя второй раз не выполнится —
  //     без перезагрузки Meta не переинициализируется и _fbp не вернётся.
  //
  // Первое решение перезагрузки не требует: теги там монтируются с нуля.
  const changed =
    previous &&
    (previous.analytics !== decision.analytics || previous.marketing !== decision.marketing);
  if (changed) pageReloader.reload();
}

const TRACKING_COOKIE_PREFIXES = ['_ga', '_gid', '_gcl', '_fbp', '_fbc', '_ttp', '_tt_'];

/**
 * Отзыв согласия должен убирать уже поставленные cookies, иначе «Widerruf»
 * ничего не меняет. Домен cookie нам неизвестен — гасим по всем вариантам
 * (host, .host и родительские зоны).
 */
export function clearTrackingCookies(): void {
  if (typeof document === 'undefined') return;

  const host = window.location.hostname;
  const domains: (string | null)[] = [null, host, `.${host}`];
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    domains.push(`.${parts.slice(i).join('.')}`);
  }

  const names = document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim())
    .filter((name): name is string =>
      Boolean(name) && TRACKING_COOKIE_PREFIXES.some((prefix) => name!.startsWith(prefix))
    );

  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${
        domain ? `; domain=${domain}` : ''
      }`;
    }
  }
}

// ---------------------------------------------------------------------------
// Бутстрап
// ---------------------------------------------------------------------------

/**
 * Инлайн-скрипт для <Script strategy="beforeInteractive"> в корневом layout.
 *
 * Должен выполниться ДО gtag.js, иначе Consent Mode не успевает выставить
 * значения по умолчанию и первый хит уходит с cookies. Сам по себе ничего
 * не хранит и не читает у третьих сторон — только dataLayer и localStorage
 * нашего домена, поэтому согласия не требует.
 */
export function consentBootstrapScript(): string {
  return `
(function(){
  window.dataLayer = window.dataLayer || [];
  function gtag(){window.dataLayer.push(arguments);}
  window.gtag = window.gtag || gtag;

  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', true);

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    personalization_storage: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  try {
    var raw = window.localStorage.getItem('${CONSENT_STORAGE_KEY}');
    var saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.version === ${CONSENT_VERSION}) {
      var marketing = saved.marketing === true ? 'granted' : 'denied';
      gtag('consent', 'update', {
        ad_storage: marketing,
        ad_user_data: marketing,
        ad_personalization: marketing,
        personalization_storage: marketing,
        analytics_storage: saved.analytics === true ? 'granted' : 'denied'
      });
      gtag('set', 'ads_data_redaction', saved.marketing !== true);
    }
  } catch (e) {
    /* iOS с заблокированными cookies бросает на само обращение к localStorage */
  }

  gtag('js', new Date());
})();
`.trim();
}
