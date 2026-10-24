"use client";

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, ShoppingBag, X } from 'lucide-react';
import ProductModal from '../ProductModal';
import { SafeImage } from '../SafeImage';
import { NoTranslate } from '../NoTranslate';
import { cachedJson } from '../../lib/client-cache';
import {
  getOrderableSizes,
  getProductDisplayPrice,
  hasNoActiveRegularSizes,
} from '../../lib/product-pricing';
import { MINI_BOX_CATEGORY_SLUG } from '../../lib/mini-pizza-box';
import { useKitchenBlocks } from '../../lib/contexts/KitchenBlocksContext';
import { readCategoryId } from '../promotions/PromotionBadgesContext';
import { formatEuro } from '../../lib/format-euro';

/**
 * «Artikel hinzufügen» на checkout: гостю не хватает до Mindestbestellwert —
 * добираем товар прямо отсюда, не уходя в меню (иначе корзина/форма теряют
 * контекст). Выбор товара — штатный ProductModal (размеры, опции, стоп цеха),
 * недостающая сумма пересчитывается вживую из корзины.
 *
 * Без minOrderAmount окно работает как обычный «добавить ещё» (гость убрал
 * товар в оформлении и хочет взять другой): без прогресса и доплаты.
 */

interface CategoryRef {
  _id?: string;
  id?: string;
  name?: string;
  slug?: string;
  order?: number;
}

export interface TopUpProduct {
  _id: string;
  name: string;
  basePrice: number;
  sizes?: any[];
  image?: string;
  category?: CategoryRef | string | null;
  featured?: boolean;
}

interface Suggestion {
  product: TopUpProduct;
  price: number;
  hasSizes: boolean;
  categorySlug: string;
  categoryName: string;
}

const SUGGESTED_TAB = '__passend';
const SUGGESTED_LIMIT = 12;

function readCategory(cat: TopUpProduct['category']) {
  if (cat && typeof cat === 'object') {
    const slug = cat.slug || cat._id || cat.id || 'weitere';
    return { slug, name: cat.name || slug, order: typeof cat.order === 'number' ? cat.order : 9999 };
  }
  if (typeof cat === 'string' && cat) return { slug: cat, name: cat, order: 9999 };
  return { slug: 'weitere', name: 'Weitere', order: 100000 };
}

/**
 * Подборка «Passend»: сначала товары, которые ЗАКРЫВАЮТ недостачу одним
 * добавлением (дешёвые вперёд — меньше переплата), затем те, что дешевле
 * недостачи (самые близкие к ней вперёд).
 */
export function rankTopUpSuggestions<T extends { price: number }>(
  items: T[],
  shortfall: number,
  limit = SUGGESTED_LIMIT
): T[] {
  const covering = items.filter((i) => i.price >= shortfall).sort((a, b) => a.price - b.price);
  const partial = items.filter((i) => i.price < shortfall).sort((a, b) => b.price - a.price);
  return [...covering, ...partial].slice(0, limit);
}

interface MinOrderTopUpModalProps {
  /** Сколько ещё не хватает (живое значение из корзины). */
  shortfall?: number;
  /** Минимум зоны; не задан — режим «просто добавить товар». */
  minOrderAmount?: number;
  /** «Differenz zahlen» — согласие на Mindermengenzuschlag. */
  onPaySurcharge?: () => void;
  /** Живая сумма товаров в корзине — отклик на добавление, пока окно открыто. */
  cartTotal?: number;
  onClose: () => void;
  t?: (key: string, fallback?: string) => string;
}

export default function MinOrderTopUpModal({
  shortfall = 0,
  minOrderAmount = 0,
  onPaySurcharge,
  cartTotal,
  onClose,
  t = (_k, fb) => fb || '',
}: MinOrderTopUpModalProps) {
  const [products, setProducts] = useState<TopUpProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // null — вкладка по умолчанию (подборка «Passend» или первая категория).
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // Выбранный товар живёт дольше открытого окна: ProductModal остаётся
  // смонтированным, чтобы успеть сыграть анимацию закрытия.
  const [picked, setPicked] = useState<{
    id: string;
    origin: { x: number; y: number } | null;
    preview: { name: string; image?: string };
  } | null>(null);
  const [pickedOpen, setPickedOpen] = useState(false);
  const { blockedWorkshopFor, showNotice } = useKitchenBlocks();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await cachedJson('/api/products?available=true');
        if (!cancelled) {
          if (data?.success) setProducts(data.products || []);
          else setLoadError(true);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape закрывает окно — но не поверх открытого ProductModal (у того свой Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pickedOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pickedOpen]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const list: Suggestion[] = [];
    for (const product of products) {
      const category = readCategory(product.category);
      // Mini-Box собирается в своём полноэкранном конструкторе — не отсюда.
      if (category.slug === MINI_BOX_CATEGORY_SLUG) continue;
      if (hasNoActiveRegularSizes(product as any)) continue;
      const price = getProductDisplayPrice(product as any);
      if (!(price > 0)) continue;
      list.push({
        product,
        price,
        hasSizes: getOrderableSizes(product as any).length > 1,
        categorySlug: category.slug,
        categoryName: category.name,
      });
    }
    return list;
  }, [products]);

  const tabs = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; order: number }>();
    for (const product of products) {
      const category = readCategory(product.category);
      if (category.slug === MINI_BOX_CATEGORY_SLUG) continue;
      if (!map.has(category.slug)) map.set(category.slug, category);
    }
    const present = new Set(suggestions.map((s) => s.categorySlug));
    return Array.from(map.values())
      .filter((c) => present.has(c.slug))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [products, suggestions]);

  const browse = !(minOrderAmount > 0);
  const currentTab = activeTab ?? (browse ? tabs[0]?.slug ?? '' : SUGGESTED_TAB);

  const visible = useMemo(() => {
    if (currentTab === SUGGESTED_TAB) return rankTopUpSuggestions(suggestions, shortfall);
    return suggestions
      .filter((s) => s.categorySlug === currentTab)
      .sort((a, b) => Number(!!b.product.featured) - Number(!!a.product.featured));
    // Подборку не пересортировываем на каждое добавление: shortfall меняется,
    // а прыгающий список под пальцем мешает. Фиксируем при открытии вкладки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab, suggestions]);

  const reached = !browse && shortfall <= 0;
  const progress = minOrderAmount > 0
    ? Math.min(100, Math.max(0, ((minOrderAmount - Math.max(shortfall, 0)) / minOrderAmount) * 100))
    : 100;

  const openProduct = (s: Suggestion, target: HTMLElement) => {
    const workshop = blockedWorkshopFor({
      categoryId: readCategoryId(s.product.category),
      name: s.product.name,
    });
    if (workshop) {
      showNotice([workshop]);
      return;
    }
    const rect = target.getBoundingClientRect();
    setPicked({
      id: s.product._id,
      origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      preview: { name: s.product.name, image: s.product.image },
    });
    setPickedOpen(true);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
        // Клик по фону закрывает окно. Проверяем target: события из портала
        // ProductModal всплывают по React-дереву и сюда тоже.
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="flex w-full max-w-xl flex-col bg-white shadow-xl max-h-[92dvh] rounded-t-2xl sm:rounded-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="min-order-topup-title"
        >
          <div className="shrink-0 border-b p-5">
            <div className="flex items-start gap-3">
              <div className={`rounded-full p-2 ${reached ? 'bg-emerald-100' : 'bg-primary-100'}`}>
                {reached
                  ? <Check className="h-6 w-6 text-emerald-600" />
                  : <ShoppingBag className="h-6 w-6 text-primary-600" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="min-order-topup-title" className="text-lg font-bold text-gray-900">
                  {reached
                    ? t('checkout.topup_reached_title', 'Mindestbestellwert erreicht')
                    : t('checkout.topup_title', 'Artikel hinzufügen')}
                </h2>
                {!browse && (
                  <p className="mt-1 text-sm text-gray-600">
                    {reached ? (
                      t('checkout.topup_reached_text', 'Sie können jetzt mit der Bestellung fortfahren.')
                    ) : (
                      <>
                        {t('checkout.topup_missing', 'Bis zum Mindestbestellwert fehlen noch')}{' '}
                        <NoTranslate className="font-semibold text-gray-900">{formatEuro(shortfall)}</NoTranslate>
                        {' '}(<NoTranslate>{formatEuro(minOrderAmount)}</NoTranslate>)
                      </>
                    )}
                  </p>
                )}
                {cartTotal != null && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('checkout.topup_in_cart', 'Im Warenkorb')}:{' '}
                    <NoTranslate>{formatEuro(cartTotal)}</NoTranslate>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 -mt-1 rounded-full p-2 text-gray-500 hover:bg-gray-100"
                aria-label={t('common.close', 'Schließen')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {!browse && (
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${reached ? 'bg-emerald-500' : 'bg-primary-600'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>

          {!reached && (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b px-5 py-3 [scrollbar-width:none]">
              {(browse ? tabs : [{ slug: SUGGESTED_TAB, name: t('checkout.topup_suggested', 'Passend') }, ...tabs]).map((tab) => (
                <button
                  key={tab.slug}
                  type="button"
                  onClick={() => setActiveTab(tab.slug)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    currentTab === tab.slug
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {tab.slug === SUGGESTED_TAB ? tab.name : <NoTranslate>{tab.name}</NoTranslate>}
                </button>
              ))}
            </div>
          )}

          {!reached && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {loading ? (
                <p className="flex items-center justify-center py-10 text-sm text-gray-600">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.loading', 'Wird geladen...')}
                </p>
              ) : loadError || visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-600">
                  {t('checkout.topup_empty', 'Keine passenden Artikel gefunden.')}
                </p>
              ) : (
                <ul className="divide-y">
                  {visible.map((s) => {
                    const covers = s.price >= shortfall;
                    return (
                      <li key={s.product._id}>
                        <button
                          type="button"
                          onClick={(e) => openProduct(s, e.currentTarget)}
                          className="flex w-full items-center gap-3 py-3 text-left hover:bg-gray-50"
                        >
                          {s.product.image ? (
                            <SafeImage
                              src={s.product.image}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">🍕</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <NoTranslate className="line-clamp-2 font-medium leading-snug text-gray-900">{s.product.name}</NoTranslate>
                            <span className="block truncate text-xs text-gray-500">
                              <NoTranslate>{s.categoryName}</NoTranslate>
                              {currentTab === SUGGESTED_TAB && covers && (
                                <span className="ml-2 font-medium text-emerald-700">
                                  ✓ {t('checkout.topup_covers', 'reicht aus')}
                                </span>
                              )}
                            </span>
                          </div>
                          <NoTranslate className="shrink-0 text-sm font-semibold text-gray-900">
                            {s.hasSizes ? `${t('checkout.topup_from', 'ab')} ` : ''}{formatEuro(s.price)}
                          </NoTranslate>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white">
                            <Plus className="h-5 w-5" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="flex shrink-0 flex-col gap-2 border-t bg-gray-50 p-4 sm:flex-row sm:rounded-b-xl">
            {browse ? (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg bg-primary-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-primary-700"
              >
                {t('checkout.topup_browse_done', 'Fertig')}
              </button>
            ) : reached ? (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                {t('checkout.topup_done', 'Weiter zur Bestellung')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-100"
                >
                  {t('common.close', 'Schließen')}
                </button>
                {onPaySurcharge && (
                  <button
                    type="button"
                    onClick={onPaySurcharge}
                    className="flex-1 rounded-lg border border-primary-600 bg-white px-4 py-3 font-semibold text-primary-700 transition-colors hover:bg-primary-50"
                  >
                    {t('checkout.surcharge_pay', 'Differenz zahlen')}{' '}
                    <NoTranslate>(+{formatEuro(shortfall)})</NoTranslate>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {picked && (
        <ProductModal
          isOpen={pickedOpen}
          onClose={() => setPickedOpen(false)}
          productId={picked.id}
          origin={picked.origin}
          preview={picked.preview}
        />
      )}
    </>
  );
}
