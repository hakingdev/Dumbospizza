'use client';

/** Меню: категории, товары, добавки, stop-list (канвы D3 / 04). */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import {
  AdminProduct,
  productBasePrice,
  setOptionActive,
  setProductAvailability,
  useCategories,
  useOptionGroups,
  useOptions,
  useProducts,
} from '../../../components/admin-v2/hooks';
import ProductModal from '../../../components/admin-v2/product-modal';
import { euro } from '../../../components/admin-v2/format';
import {
  Card,
  EmptyState,
  Icon,
  LoadError,
  Loading,
  SectionLabel,
  TabPill,
  btnOutline,
  btnPrimary,
  btnSoft,
} from '../../../components/admin-v2/ui';
import { ADMIN_V2_BASE } from '../../../components/admin-v2/nav';

/** Выбор в сайдбаре: id категории | добавки | stop-list | все товары. */
type Selection = { kind: 'all' } | { kind: 'category'; id: string } | { kind: 'extras' } | { kind: 'stoplist' };

const CATEGORY_EMOJI: [RegExp, string][] = [
  [/pizza/i, '🍕'],
  [/sushi/i, '🍣'],
  [/pasta|nudel/i, '🍝'],
  [/salat/i, '🥗'],
  [/snack|bomb|nugget|finger/i, '🧆'],
  [/getränk|drink|cola|wasser/i, '🥤'],
  [/dessert|süß/i, '🍰'],
  [/burger/i, '🍔'],
];

function productEmoji(product: AdminProduct, categoryName: string): string {
  const hay = `${product.name} ${categoryName}`;
  for (const [re, emoji] of CATEGORY_EMOJI) if (re.test(hay)) return emoji;
  return '🍕';
}

function categoryId(product: AdminProduct): string {
  const cat = product.category as any;
  return typeof cat === 'object' && cat ? String(cat._id) : String(cat || '');
}

function productPriceLabel(product: AdminProduct): string {
  const sizes = product.sizes;
  if (sizes?.length) {
    const prices = sizes.map((size) => Number(size.price)).filter((p) => p > 0);
    if (prices.length) return `ab ${euro(Math.min(...prices))}`;
  }
  return euro(productBasePrice(product));
}

function productMetaLine(product: AdminProduct, categoryName: string): string {
  const parts: string[] = [];
  const sizes = (product as any).sizes as unknown[] | undefined;
  const groups = (product as any).optionGroupIds as unknown[] | undefined;
  if (sizes?.length) parts.push(`${sizes.length} ${plural(sizes.length, 'размер', 'размера', 'размеров')}`);
  if (groups?.length) parts.push(`${groups.length} ${plural(groups.length, 'группа опций', 'группы опций', 'групп опций')}`);
  if (!parts.length && categoryName) parts.push(categoryName);
  return parts.join(' · ');
}

/* ------------------------------------------------------------ тумблер */

function Toggle({
  on,
  onChange,
  busy,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className="relative h-[26px] w-11 flex-none cursor-pointer rounded-full border-none transition disabled:opacity-50"
      style={{ background: on ? '#8A6C4C' : '#D1D5DB' }}
    >
      <span
        className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(17,24,39,.24)] transition-all"
        style={{ left: on ? 21 : 3 }}
      />
    </button>
  );
}

/* ----------------------------------------------------------- страница */

function MenuPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const cats = useCategories();
  const { categories } = cats;
  const products = useProducts();
  const options = useOptions();
  const groups = useOptionGroups();

  /* Товары/категории не загрузились — контент заменяется error-блоком */
  const menuFailed = (!!products.error && !products.data) || (!!cats.error && !cats.data);
  const menuError = products.error || cats.error;
  const retryMenu = () => {
    if (products.error || !products.data) products.reload();
    if (cats.error || !cats.data) cats.reload();
  };
  const optionsFailed = !!options.error && !options.data;

  const tabParam = searchParams.get('tab');
  const initial: Selection =
    tabParam === 'extras'
      ? { kind: 'extras' }
      : tabParam === 'stoplist'
        ? { kind: 'stoplist' }
        : { kind: 'all' };
  const [selection, setSelection] = useState<Selection>(initial);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Модалка товара (D3.1): null — закрыта, {product:null} — новый товар. */
  const [modal, setModal] = useState<{ product: AdminProduct | null } | null>(null);

  const stopList = useMemo(
    () => products.products.filter((product) => product.available === false),
    [products.products]
  );

  const countsByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products.products) {
      const id = categoryId(product);
      map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }, [products.products]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) map.set(String(category._id), category.name);
    return map;
  }, [categories]);

  const optionGroupNames = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of groups.groups) {
      for (const ref of group.optionIds || []) {
        const id = typeof ref === 'object' && ref ? String((ref as any)._id) : String(ref);
        const list = map.get(id) || [];
        list.push(group.name);
        map.set(id, list);
      }
    }
    return map;
  }, [groups.groups]);

  const visibleProducts = useMemo(() => {
    let list = products.products;
    if (selection.kind === 'category') list = list.filter((p) => categoryId(p) === selection.id);
    if (selection.kind === 'stoplist') list = list.filter((p) => p.available === false);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products.products, selection, search]);

  /** Мобильная группировка по категориям (в порядке категорий). */
  const grouped = useMemo(() => {
    const buckets: { id: string; name: string; items: AdminProduct[] }[] = [];
    const order = new Map<string, number>();
    for (const category of categories) {
      order.set(String(category._id), buckets.length);
      buckets.push({ id: String(category._id), name: category.name, items: [] });
    }
    const rest: AdminProduct[] = [];
    for (const product of visibleProducts) {
      const idx = order.get(categoryId(product));
      if (idx === undefined) rest.push(product);
      else buckets[idx].items.push(product);
    }
    if (rest.length) buckets.push({ id: '__rest__', name: 'Без категории', items: rest });
    return buckets.filter((bucket) => bucket.items.length > 0);
  }, [categories, visibleProducts]);

  const toggleProduct = async (product: AdminProduct, next: boolean) => {
    setBusyId(product._id);
    const ok = await setProductAvailability(product._id, next);
    if (!ok) alert('Не удалось обновить доступность товара');
    products.reload();
    setBusyId(null);
  };

  const toggleOption = async (optionId: string, next: boolean) => {
    setBusyId(optionId);
    const ok = await setOptionActive(optionId, next);
    if (!ok) alert('Не удалось обновить опцию');
    options.reload();
    setBusyId(null);
  };

  const loading = (products.loading && !products.data) || (cats.loading && !cats.data);

  /* Карточка товара (десктоп-сетка) */
  const DesktopProductCard = ({ product }: { product: AdminProduct }) => {
    const catName = categoryNameById.get(categoryId(product)) || '';
    const off = product.available === false;
    return (
      <Card
        className={`flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(17,24,39,.10)] ${
          off ? 'opacity-70' : ''
        }`}
      >
        <div className="relative flex h-[120px] items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-[40px]">
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image} alt="" className="h-full w-full object-cover" />
          ) : (
            productEmoji(product, catName)
          )}
          {off ? (
            <span className="absolute left-2 top-2 inline-flex h-6 items-center rounded-full bg-[#FDE6E7] px-2.5 text-xs font-bold leading-4 text-[#D42A47]">
              Stop-list
            </span>
          ) : product.featured ? (
            <span className="absolute left-2 top-2 inline-flex h-6 items-center rounded-full bg-[#FEF9C3] px-2.5 text-xs font-bold leading-4 text-[#713F12]">
              Хит
            </span>
          ) : null}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold leading-6 text-gray-900">{product.name}</div>
            <div className="text-sm leading-5 text-gray-600">{productMetaLine(product, catName)}</div>
          </div>
          <Toggle
            on={!off}
            busy={busyId === product._id}
            label={off ? 'Вернуть в продажу' : 'Убрать в stop-list'}
            onChange={(next) => toggleProduct(product, next)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-bold leading-6 text-gray-900 tabular-nums">
            {productPriceLabel(product)}
          </span>
          <button
            type="button"
            onClick={() => setModal({ product })}
            className="inline-flex h-8 cursor-pointer items-center rounded-xl border-none bg-transparent px-3 text-sm font-bold leading-5 text-gray-900 transition hover:bg-[#FAF7F2]"
          >
            Редактировать
          </button>
        </div>
      </Card>
    );
  };

  /* Строка товара (мобилка) */
  const MobileProductRow = ({ product }: { product: AdminProduct }) => {
    const catName = categoryNameById.get(categoryId(product)) || '';
    const off = product.available === false;
    return (
      <div
        onClick={() => setModal({ product })}
        className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_1px_2px_rgba(17,24,39,.04),0_2px_8px_rgba(17,24,39,.06)] ${
          off ? 'opacity-70' : ''
        }`}
      >
        <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-2xl">
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image} alt="" className="h-full w-full object-cover" />
          ) : (
            productEmoji(product, catName)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-6 text-gray-900">
            {product.name}
          </div>
          {off ? (
            <div className="text-sm font-bold leading-5 text-[#D42A47]">В stop-list</div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm leading-5 text-gray-600 tabular-nums">
              {productPriceLabel(product)}
              {product.featured && (
                <span className="inline-flex h-5 items-center rounded-full bg-[#FEF9C3] px-2 text-xs font-bold leading-4 text-[#713F12]">
                  Хит
                </span>
              )}
            </div>
          )}
        </div>
        <Toggle
          on={!off}
          busy={busyId === product._id}
          label={off ? 'Вернуть в продажу' : 'Убрать в stop-list'}
          onChange={(next) => toggleProduct(product, next)}
        />
      </div>
    );
  };

  /* Таблица добавок */
  const ExtrasTable = () => (
    <Card>
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-4 lg:p-6">
        <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Добавки · Extras</h3>
        <a href="/admin/options" className={`${btnSoft} h-8 px-3 text-sm no-underline`}>
          Управлять опциями
        </a>
      </div>
      {options.loading && !options.data ? (
        <Loading />
      ) : optionsFailed ? (
        <LoadError framed={false} title="Добавки не загрузились" detail={options.error} onRetry={options.reload} />
      ) : options.options.length ? (
        options.options.map((option, i) => (
          <div
            key={option._id}
            className={`flex items-center gap-3 px-4 py-4 transition hover:bg-[#FAF7F2] lg:gap-4 lg:px-6 ${
              i === options.options.length - 1 ? '' : 'border-b border-gray-200'
            }`}
          >
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base leading-6 text-gray-900">
              {option.name}
            </span>
            <span className="w-20 flex-none text-right text-base font-bold leading-6 text-gray-900 tabular-nums lg:w-[120px]">
              +{euro(option.price)}
            </span>
            <span className="hidden w-[160px] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600 lg:block">
              {(optionGroupNames.get(String(option._id)) || []).join(', ') || '—'}
            </span>
            <Toggle
              on={option.active !== false}
              busy={busyId === option._id}
              label={option.active !== false ? 'Выключить опцию' : 'Включить опцию'}
              onChange={(next) => toggleOption(option._id, next)}
            />
          </div>
        ))
      ) : (
        <div className="p-8 text-center text-gray-500">Опций пока нет</div>
      )}
    </Card>
  );

  const showProducts = selection.kind !== 'extras';

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      {/* Заголовок */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Меню
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            {products.data && cats.data
              ? `${categories.length} категорий · ${products.products.length} товаров · ${stopList.length} ${plural(stopList.length, 'позиция', 'позиции', 'позиций')} в stop-list`
              : menuFailed
                ? 'Не удалось загрузить меню'
                : 'Загрузка…'}
          </p>
        </div>
        <div className="hidden items-center gap-3 lg:flex">
          <button
            type="button"
            onClick={() => setModal({ product: null })}
            className={`${btnOutline} h-12 px-6 text-lg`}
          >
            Добавить товар
          </button>
          <a
            href="/admin/categories"
            className={`${btnPrimary} h-12 min-w-[96px] px-6 text-lg no-underline`}
          >
            Новая категория
          </a>
        </div>
      </div>

      {/* Мобилка: чипы разделов + поиск */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden">
        {[
          { key: 'all', label: 'Товары' },
          { key: 'extras', label: 'Добавки' },
        ].map((chip) => {
          const active =
            (chip.key === 'all' && (selection.kind === 'all' || selection.kind === 'category')) ||
            selection.kind === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSelection(chip.key === 'extras' ? { kind: 'extras' } : { kind: 'all' })}
              className={
                active
                  ? 'inline-flex h-8 flex-none cursor-pointer items-center rounded-full border-none bg-[#8A6C4C] px-3.5 text-sm font-bold leading-5 text-white'
                  : 'inline-flex h-8 flex-none cursor-pointer items-center rounded-full border border-gray-200 bg-white px-3.5 text-sm font-bold leading-5 text-gray-900'
              }
            >
              {chip.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSelection({ kind: 'stoplist' })}
          className={`inline-flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-full border-none px-3.5 text-sm font-bold leading-5 ${
            selection.kind === 'stoplist' ? 'bg-[#D42A47] text-white' : 'bg-[#FDE6E7] text-[#D42A47]'
          }`}
        >
          Stop-list <span className="tabular-nums">{products.data ? stopList.length : '–'}</span>
        </button>
        {categories.map((category) => {
          const active = selection.kind === 'category' && selection.id === String(category._id);
          return (
            <button
              key={category._id}
              type="button"
              onClick={() => setSelection({ kind: 'category', id: String(category._id) })}
              className={
                active
                  ? 'inline-flex h-8 flex-none cursor-pointer items-center rounded-full border-none bg-[#8A6C4C] px-3.5 text-sm font-bold leading-5 text-white'
                  : 'inline-flex h-8 flex-none cursor-pointer items-center rounded-full border border-gray-200 bg-white px-3.5 text-sm font-bold leading-5 text-gray-900'
              }
            >
              {category.name}
            </button>
          );
        })}
      </div>

      {showProducts && (
        <div className="flex h-12 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 lg:hidden">
          <Icon d="M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z M20 20l-3.5-3.5" size={20} stroke="#9CA3AF" className="flex-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по товарам"
            className="w-full border-none bg-transparent text-base leading-6 text-gray-900 outline-none placeholder:text-gray-400"
          />
        </div>
      )}

      {/* Мобилка: stop-list карточка */}
      {selection.kind !== 'extras' && stopList.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[#EBE0CE] bg-[#F5F0E8] p-4 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Stop-list на сегодня</h3>
            <span className="inline-flex h-6 items-center rounded-full bg-[#FDE6E7] px-2.5 text-xs font-bold leading-4 text-[#D42A47]">
              {stopList.length} {plural(stopList.length, 'позиция', 'позиции', 'позиций')}
            </span>
          </div>
          {stopList.slice(0, 4).map((product, i) => (
            <div
              key={product._id}
              className={`flex items-center gap-3 ${
                i === Math.min(stopList.length, 4) - 1 ? '' : 'border-b border-[#EBE0CE] pb-3'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold leading-6 text-gray-900">{product.name}</div>
                <div className="text-sm leading-5 text-gray-600">
                  {categoryNameById.get(categoryId(product)) || 'Без категории'}
                </div>
              </div>
              <Toggle
                on={false}
                busy={busyId === product._id}
                label="Вернуть в продажу"
                onChange={() => toggleProduct(product, true)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Десктоп: сайдбар категорий + вкладки + контент (D3) */}
      <div className="hidden items-start gap-6 lg:grid lg:grid-cols-[280px_1fr]">
        <Card className="flex flex-col gap-0.5 p-4 py-5">
          <SectionLabel>Категории</SectionLabel>
          <div className="h-1.5 flex-none" />
          {categories.map((category) => {
            const id = String(category._id);
            const active = selection.kind === 'category' && selection.id === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelection({ kind: 'category', id })}
                className={`flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border-none px-3 text-left text-base leading-6 transition ${
                  active
                    ? 'bg-[#FAF7F2] font-bold text-[#7C6145]'
                    : 'bg-transparent text-gray-900 hover:bg-[#FAF7F2]'
                }`}
              >
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {category.name}
                </span>
                <span className="flex-none font-normal text-gray-500 tabular-nums">
                  {countsByCategory.get(id) || 0}
                </span>
              </button>
            );
          })}
          <div className="flex-none py-2">
            <div className="h-px bg-gray-200" />
          </div>
          <button
            type="button"
            onClick={() => setSelection({ kind: 'extras' })}
            className={`flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border-none px-3 text-left text-base leading-6 transition ${
              selection.kind === 'extras'
                ? 'bg-[#FAF7F2] font-bold text-[#7C6145]'
                : 'bg-transparent text-gray-900 hover:bg-[#FAF7F2]'
            }`}
          >
            <span className="min-w-0 flex-1">Добавки</span>
            <span className="flex-none font-normal text-gray-500 tabular-nums">
              {options.data ? options.options.length : '–'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSelection({ kind: 'stoplist' })}
            className={`flex h-11 w-full cursor-pointer items-center gap-2 rounded-xl border-none px-3 text-left text-base font-bold leading-6 text-[#D42A47] transition ${
              selection.kind === 'stoplist' ? 'bg-[#FDE6E7]' : 'bg-transparent hover:bg-[#FDE6E7]'
            }`}
          >
            <span className="min-w-0 flex-1">Stop-list</span>
            <span className="flex-none font-normal tabular-nums">
              {products.data ? stopList.length : '–'}
            </span>
          </button>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Вкладки над сеткой: Все товары / категории / Добавки / Stop-list */}
          <div className="flex flex-wrap items-center gap-2">
            <TabPill
              label="Все товары"
              active={selection.kind === 'all'}
              onClick={() => setSelection({ kind: 'all' })}
            />
            {categories.map((category) => {
              const id = String(category._id);
              return (
                <TabPill
                  key={id}
                  label={category.name}
                  active={selection.kind === 'category' && selection.id === id}
                  onClick={() => setSelection({ kind: 'category', id })}
                />
              );
            })}
            <TabPill
              label="Добавки"
              active={selection.kind === 'extras'}
              onClick={() => setSelection({ kind: 'extras' })}
            />
            <TabPill
              label="Stop-list"
              active={selection.kind === 'stoplist'}
              onClick={() => setSelection({ kind: 'stoplist' })}
            />
          </div>

          {selection.kind === 'extras' ? (
            <ExtrasTable />
          ) : loading ? (
            <Loading />
          ) : menuFailed ? (
            <LoadError title="Меню не загрузилось" detail={menuError} onRetry={retryMenu} />
          ) : visibleProducts.length ? (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {visibleProducts.map((product) => (
                <DesktopProductCard key={product._id} product={product} />
              ))}
            </div>
          ) : selection.kind === 'stoplist' ? (
            <EmptyState
              title="Stop-list пуст"
              note="Все товары в продаже и видны в витрине"
            />
          ) : search.trim() ? (
            <EmptyState title="Ничего не найдено" note="Попробуйте изменить поисковый запрос" />
          ) : (
            <EmptyState
              title={
                selection.kind === 'category'
                  ? `В категории «${categoryNameById.get(selection.id) || '…'}» пока нет товаров`
                  : 'В меню пока нет товаров'
              }
              note="Добавьте первую позицию — она появится в витрине сразу после сохранения"
              action={
                <button
                  type="button"
                  onClick={() => setModal({ product: null })}
                  className={`${btnPrimary} h-10 min-w-[96px] px-4 text-base`}
                >
                  Добавить товар
                </button>
              }
            />
          )}
        </div>
      </div>

      {/* Мобилка: список */}
      <div className="flex flex-col gap-4 lg:hidden">
        {selection.kind === 'extras' ? (
          <ExtrasTable />
        ) : loading ? (
          <Loading />
        ) : menuFailed ? (
          <LoadError title="Меню не загрузилось" detail={menuError} onRetry={retryMenu} />
        ) : selection.kind === 'stoplist' ? (
          <div className="flex flex-col gap-3">
            {stopList.length ? (
              stopList.map((product) => <MobileProductRow key={product._id} product={product} />)
            ) : (
              <Card className="p-6 text-center text-gray-500">Stop-list пуст</Card>
            )}
          </div>
        ) : (
          grouped.map((bucket) => (
            <div key={bucket.id} className="flex flex-col gap-3">
              <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
                {bucket.name}
              </h2>
              {bucket.items.map((product) => (
                <MobileProductRow key={product._id} product={product} />
              ))}
            </div>
          ))
        )}
        {selection.kind !== 'extras' && (
          <button
            type="button"
            onClick={() => setModal({ product: null })}
            className={`${btnPrimary} h-12 w-full text-lg`}
          >
            <Icon d="M5 12h14 M12 5v14" size={20} />
            Добавить товар
          </button>
        )}
      </div>

      {/* Модалка товара (D3.1a/b) */}
      <ProductModal
        open={modal !== null}
        product={modal?.product ?? null}
        categories={categories}
        groups={groups.groups}
        onClose={() => setModal(null)}
        onSaved={() => products.reload()}
      />
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export default function MenuPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MenuPageInner />
    </Suspense>
  );
}
