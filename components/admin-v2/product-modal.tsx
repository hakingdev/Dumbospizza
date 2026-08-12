'use client';

/**
 * Модалка товара (канва D3.1a/b/c/d + компонент «Модалка товара»):
 * редактирование и создание, фото, видимость/stop-list, размеры и цены,
 * группы опций, налоги; валидация и алерт несохранённых изменений.
 * Демо-поля без бэкенда помечены (PLU, время приготовления, состав, языки).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdminCategory,
  AdminOptionGroup,
  AdminProduct,
  useJson,
} from './hooks';
import { DemoTag, Icon, SectionLabel } from './ui';

const FOOD_VAT = 0.07;
const BEVERAGE_VAT = 0.19;

type SizeRow = {
  id: string;
  variationId?: string;
  name: string;
  label: string;
  price: string; // строка в форме, число при сохранении
  active?: boolean;
};

type FormState = {
  name: string;
  description: string;
  category: string;
  image: string;
  available: boolean;
  featured: boolean;
  taxRate: number;
  basePrice: string;
  sizes: SizeRow[];
  optionGroupIds: string[];
};

function groupId(ref: string | { _id: string }): string {
  return typeof ref === 'object' && ref ? String((ref as any)._id) : String(ref);
}

/** Цена из БД в инпут формы: 8.9 → «8,90», как в макете (всегда два знака). */
function formatPriceInput(value: unknown): string {
  const num = Number(value);
  return value != null && Number.isFinite(num) ? num.toFixed(2).replace('.', ',') : '';
}

function initForm(product: AdminProduct | null): FormState {
  const raw = product as any;
  return {
    name: product?.name || '',
    description: product?.description || '',
    category:
      typeof raw?.category === 'object' && raw?.category
        ? String(raw.category._id)
        : String(raw?.category || ''),
    image: product?.image || '',
    available: product ? product.available !== false : true,
    featured: !!product?.featured,
    taxRate: Number(raw?.taxRate) === BEVERAGE_VAT ? BEVERAGE_VAT : FOOD_VAT,
    basePrice: formatPriceInput(raw?.basePrice),
    sizes: ((raw?.sizes as any[]) || []).map((size, i) => ({
      id: String(size.id || size.variationId || `size-${i}`),
      variationId: size.variationId ? String(size.variationId) : undefined,
      name: size.name || '',
      label: size.label || size.size || '',
      price: formatPriceInput(size.price),
      active: size.active !== false,
    })),
    optionGroupIds: ((raw?.optionGroupIds as any[]) || []).map(groupId),
  };
}

const MAX_PRICE = 999;

/**
 * «12,50» → 12.5. Минус и мусор НЕ отбрасываются молча: «-50» → -50,
 * «abc» → NaN — такие значения отсекает isValidPrice, а не тихая чистка.
 */
function parsePrice(value: string): number {
  const cleaned = String(value).trim().replace(',', '.').replace(/[^\d.\-]/g, '');
  if (!cleaned) return NaN;
  return Number(cleaned);
}

/** Валидная цена: число от 0,01 до 999 €. */
function isValidPrice(value: string): boolean {
  const num = parsePrice(value);
  return Number.isFinite(num) && num > 0 && num <= MAX_PRICE;
}

/* ------------------------------------------------------------ мелочи */

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative h-[26px] w-11 flex-none rounded-full border-none transition ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
      style={{ background: on ? '#8A6C4C' : '#D1D5DB' }}
    >
      <span
        className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(17,24,39,.24)] transition-all"
        style={{ left: on ? 21 : 3 }}
      />
    </button>
  );
}

const inputCls =
  'h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-base leading-6 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#8A6C4C]';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-bold leading-5 text-gray-900">{children}</label>;
}

/* --------------------------------------------- алерт несохранённого (D3.1d) */

function UnsavedAlert({
  open,
  changedHint,
  onDiscard,
  onContinue,
}: {
  open: boolean;
  changedHint: string;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-6">
      <div className="flex w-[480px] max-w-full flex-col gap-6 rounded-2xl bg-white p-8 shadow-[0_24px_48px_rgba(17,24,39,.24)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#FEF9C3]">
            <Icon
              d="m21.7 16.5-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 19.5h16a2 2 0 0 0 1.7-3Z M12 9v4 M12 17h.01"
              size={24}
              stroke="#713F12"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
              Есть несохранённые изменения
            </h2>
            <p className="m-0 text-base leading-6 text-gray-600">
              {changedHint} Если закрыть карточку, правки не сохранятся.
            </p>
          </div>
        </div>
        {/* Мобилка: кнопки в столбик (в ряд два длинных лейбла не влезали и выезжали за карточку) */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onDiscard}
            className="h-12 w-full flex-none cursor-pointer whitespace-nowrap rounded-xl border-none bg-transparent px-4 text-base font-bold leading-5 text-[#D42A47] transition hover:bg-[#FDE6E7] sm:w-auto"
          >
            Не сохранять
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="h-12 w-full flex-none cursor-pointer whitespace-nowrap rounded-xl border-none bg-[#8A6C4C] px-4 text-base font-bold leading-5 text-white shadow-[0_1px_2px_rgba(95,73,52,.24)] transition hover:bg-[#7C6145] active:scale-[.98] sm:w-auto"
          >
            Продолжить редактирование
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- модалка */

export default function ProductModal({
  open,
  product,
  categories,
  groups,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null — режим «Новый товар». */
  product: AdminProduct | null;
  categories: AdminCategory[];
  groups: AdminOptionGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !product;
  const [form, setForm] = useState<FormState>(() => initForm(product));
  const [initial, setInitial] = useState<FormState>(form);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const variationsState = useJson<{ variations: { _id: string; name: string; label: string; active: boolean }[] }>(
    open ? '/api/size-variations' : null
  );

  // Переинициализация при каждом открытии
  useEffect(() => {
    if (open) {
      const next = initForm(product);
      setForm(next);
      setInitial(next);
      setUnsavedOpen(false);
      setGroupPickerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?._id]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  const changedHint = useMemo(() => {
    const changed: string[] = [];
    if (form.name !== initial.name) changed.push('название');
    if (form.description !== initial.description) changed.push('описание');
    if (form.category !== initial.category) changed.push('категория');
    if (form.image !== initial.image) changed.push('фото');
    if (form.available !== initial.available) changed.push('видимость');
    if (form.taxRate !== initial.taxRate) changed.push('налог');
    if (JSON.stringify(form.sizes) !== JSON.stringify(initial.sizes) || form.basePrice !== initial.basePrice)
      changed.push('цены');
    if (JSON.stringify(form.optionGroupIds) !== JSON.stringify(initial.optionGroupIds))
      changed.push('группы опций');
    return changed.length ? `Изменены: ${changed.join(', ')}.` : 'Есть правки.';
  }, [form, initial]);

  const attemptClose = useCallback(() => {
    if (dirty) setUnsavedOpen(true);
    else onClose();
  }, [dirty, onClose]);

  // Esc закрывает (с проверкой несохранённого)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') attemptClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, attemptClose]);

  /*
   * ---- валидация (D3.1c): живая, без гейта «после попытки сохранить» ----
   * Строка размера обязана быть полной (название + цена) — незаполненные
   * строки раньше молча выбрасывались при сохранении, и товар мог уйти
   * в базу с ценой 0.
   */
  const nameError = !form.name.trim() ? 'Укажите название товара' : null;
  const categoryError = !form.category ? 'Выберите категорию' : null;
  const incompleteSize = form.sizes.find((size) => !size.name.trim());
  const badPriceSize = form.sizes.find((size) => size.name.trim() && !isValidPrice(size.price));
  const sizeError = incompleteSize
    ? 'Заполните название размера или удалите строку'
    : badPriceSize
      ? `Цена размера «${badPriceSize.name.trim()}» — от 0,01 до ${MAX_PRICE} €`
      : null;
  const basePriceError =
    form.sizes.length === 0 && !isValidPrice(form.basePrice)
      ? `Укажите цену от 0,01 до ${MAX_PRICE} €`
      : null;
  const hasErrors = !!(nameError || categoryError || sizeError || basePriceError);
  const firstError = nameError || categoryError || sizeError || basePriceError;

  const categoryName = useMemo(() => {
    const found = categories.find((category) => String(category._id) === form.category);
    return found?.name || '';
  }, [categories, form.category]);

  const connectedGroups = form.optionGroupIds
    .map((id) => groups.find((group) => String(group._id) === id))
    .filter(Boolean) as AdminOptionGroup[];
  const availableGroups = groups.filter(
    (group) => !form.optionGroupIds.includes(String(group._id))
  );

  /* ---- фото ---- */
  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('folder', 'products');
      const res = await fetch('/api/admin/upload', { method: 'POST', body });
      const json = await res.json();
      if (res.ok && json?.success !== false && json?.path) {
        setForm((prev) => ({ ...prev, image: json.path }));
      } else {
        alert(json?.error || 'Не удалось загрузить фото');
      }
    } catch {
      alert('Не удалось загрузить фото');
    }
    setUploading(false);
  };

  /* ---- сохранение ---- */
  const handleSave = async () => {
    if (hasErrors) return; // кнопка и так disabled — страховка
    setSaving(true);
    const cleanSizes = form.sizes
      .filter((size) => size.name.trim())
      .map((size) => ({
        id: size.id,
        variationId: size.variationId,
        name: size.name.trim(),
        label: size.label || '',
        price: parsePrice(size.price),
        active: size.active !== false,
      }));
    const payload: Record<string, any> = {
      name: form.name.trim(),
      description: form.description,
      category: form.category,
      image: form.image,
      available: form.available,
      featured: form.featured,
      taxRate: form.taxRate,
      sizes: cleanSizes,
      // как в старой форме: базовая цена = минимальная цена размера
      basePrice: cleanSizes.length
        ? Math.min(...cleanSizes.map((size) => size.price))
        : parsePrice(form.basePrice),
    };
    try {
      const res = await fetch(isNew ? '/api/products' : `/api/products/${product!._id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, optionGroupIds: form.optionGroupIds }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        alert(json?.error || 'Не удалось сохранить товар');
        setSaving(false);
        return;
      }
    } catch {
      alert('Не удалось сохранить товар');
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const handleDelete = async () => {
    if (!product) return;
    if (!confirm(`Удалить товар «${product.name}» безвозвратно?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/products/${product._id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        alert(json?.error || 'Не удалось удалить товар');
        setDeleting(false);
        return;
      }
    } catch {
      alert('Не удалось удалить товар');
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onSaved();
    onClose();
  };

  const addSizeFromLibrary = (variation: { _id: string; name: string; label: string }) => {
    setForm((prev) => ({
      ...prev,
      sizes: [
        ...prev.sizes,
        {
          id: String(variation._id),
          variationId: String(variation._id),
          name: variation.name,
          label: variation.label || '',
          price: '',
          active: true,
        },
      ],
    }));
  };

  if (!open) return null;

  const showNameError = !!nameError;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center lg:items-center lg:p-8" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={attemptClose}
        className="absolute inset-0 cursor-default border-none bg-black/45"
      />

      <div className="relative flex w-full flex-col overflow-hidden bg-white font-sans antialiased shadow-[0_24px_48px_rgba(17,24,39,.24),0_2px_8px_rgba(17,24,39,.06)] lg:h-[820px] lg:max-h-[90vh] lg:w-[880px] lg:rounded-2xl">
        {/* Шапка */}
        <div className="flex flex-none items-start gap-3 border-b border-gray-200 bg-white p-4 pb-3 lg:gap-4 lg:p-6 lg:pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="m-0 text-2xl font-extrabold leading-8 tracking-[-.02em] text-gray-900 lg:text-[32px] lg:leading-[38px]">
              {isNew ? 'Новый товар' : 'Редактировать товар'}
            </h2>
            <div className="flex items-center gap-2 text-sm leading-5 text-gray-600">
              <span>Меню</span>
              <span className="text-[#DCC9A9]">·</span>
              <span className="font-bold text-[#9A7A56]">{categoryName || 'Без категории'}</span>
            </div>
          </div>
          <div
            className="hidden h-10 flex-none items-center gap-0.5 rounded-full bg-gray-100 p-1 sm:flex"
            title="Мультиязычные поля товара появятся позже — пока одна версия текста"
          >
            {['DE', 'RU', 'EN'].map((lang, i) => (
              <span
                key={lang}
                className={
                  i === 0
                    ? 'inline-flex h-8 items-center rounded-full bg-[#8A6C4C] px-3 text-sm font-bold leading-5 text-white'
                    : 'inline-flex h-8 cursor-not-allowed items-center rounded-full px-3 text-sm font-bold leading-5 text-gray-400'
                }
              >
                {lang}
              </span>
            ))}
          </div>
          <button
            type="button"
            aria-label="Закрыть модалку"
            title="Закрыть (Esc)"
            onClick={attemptClose}
            className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <Icon d="M18 6 6 18 M6 6l12 12" size={20} />
          </button>
        </div>

        {/* Тело: слева фото/видимость, справа поля */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[320px_1fr] lg:overflow-visible">
          {/* Левая колонка */}
          <div className="flex flex-col gap-4 border-b border-gray-200 bg-[#FAFAFA] p-4 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-6">
            <div className="flex flex-col gap-3">
              <SectionLabel>Фото товара</SectionLabel>
              <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-100 text-[56px]">
                {form.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.image} alt="" className="h-full w-full object-cover" />
                ) : uploading ? (
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#8A6C4C]" />
                ) : (
                  '🖼'
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadFile(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 flex-1 cursor-pointer rounded-xl border-none bg-[#F5F0E8] text-sm font-bold leading-5 text-[#7C6145] transition hover:bg-[#EBE0CE] disabled:opacity-50"
                >
                  {uploading ? 'Загрузка…' : form.image ? 'Заменить' : 'Загрузить'}
                </button>
                {form.image && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, image: '' })}
                    className="h-8 cursor-pointer rounded-xl border-none bg-transparent px-3 text-sm font-bold leading-5 text-[#D42A47] transition hover:bg-[#FDE6E7]"
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) uploadFile(file);
                }}
                className="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#DCC9A9] bg-[#FAF7F2] p-3"
              >
                <Icon d="M12 16V4 m7 9 5-5 5 5 M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" size={20} stroke="#9A7A56" className="flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold leading-5 text-gray-900">
                    Перетащите фото сюда
                  </span>
                  <span className="block text-sm leading-5 text-gray-600">
                    JPG · PNG · от 1200×900 · до 4 МБ
                  </span>
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-200 pt-4">
              <SectionLabel>Видимость</SectionLabel>
              <div className="flex items-center gap-3">
                <span className="flex-1 text-base font-bold leading-6 text-gray-900">Активен</span>
                <Toggle
                  on={form.available}
                  label={form.available ? 'Скрыть из витрины' : 'Показать в витрине'}
                  onChange={(next) => setForm({ ...form, available: next })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, featured: !form.featured })}
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-bold leading-5 transition ${
                    form.featured
                      ? 'border-[#FEF9C3] bg-[#FEF9C3] text-[#713F12]'
                      : 'border-gray-200 bg-white text-gray-900 hover:bg-[#FAF7F2]'
                  }`}
                >
                  Хит
                </button>
                <button
                  type="button"
                  disabled
                  title="Метки «Новинка» пока нет в базе — появится вместе с расширенными бейджами"
                  className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-sm font-bold leading-5 text-gray-400"
                >
                  Новинка <DemoTag />
                </button>
              </div>
              <div className="flex items-center gap-3 border-t border-dashed border-[#EBE0CE] pt-3">
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold leading-6 text-gray-900">В stop-list</div>
                  <div className="text-sm leading-5 text-gray-600">
                    {form.available ? 'Товар продаётся' : 'Вернуть в продажу — вручную'}
                  </div>
                </div>
                <Toggle
                  on={!form.available}
                  label={form.available ? 'Убрать в stop-list' : 'Вернуть в продажу'}
                  onChange={(next) => setForm({ ...form, available: !next })}
                />
              </div>
            </div>
          </div>

          {/* Правая колонка */}
          <div className="flex min-h-0 flex-col gap-6 p-4 lg:overflow-y-auto lg:p-6">
            {/* Основное */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Основное</h3>
                <span className="inline-flex h-5 items-center rounded-full bg-[#F5F0E8] px-2 text-xs font-bold leading-4 text-[#7C6145]">
                  DEUTSCH
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel>
                  Название <span className="text-[#D42A47]">*</span>
                </FieldLabel>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="z. B. Pizza Salami"
                  required
                  aria-invalid={showNameError}
                  className={inputCls}
                  style={showNameError ? { border: '2px solid #D42A47' } : undefined}
                />
                <span className={`text-sm leading-5 ${showNameError ? 'text-[#D42A47]' : 'text-gray-400'}`}>
                  {showNameError ? nameError : 'Отображается в витрине и в чеке'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <FieldLabel>Короткое описание</FieldLabel>
                  <span
                    className={`text-sm leading-5 tabular-nums ${
                      form.description.length > 140 ? 'font-bold text-[#D42A47]' : 'text-gray-400'
                    }`}
                    title={form.description.length > 140 ? 'Рекомендуемая длина — до 140 символов' : undefined}
                  >
                    {form.description.length} / 140
                  </span>
                </div>
                <textarea
                  value={form.description}
                  maxLength={280}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Короткое описание для карточки в витрине"
                  className="min-h-[80px] w-full resize-y rounded-xl border border-gray-300 bg-white px-4 py-3 text-base leading-6 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#8A6C4C]"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <FieldLabel>
                    Категория <span className="text-[#D42A47]">*</span>
                  </FieldLabel>
                  <div className="relative">
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      required
                      aria-invalid={!!categoryError}
                      className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-gray-300 bg-white px-4 pr-10 text-base leading-6 text-gray-900 outline-none transition focus:border-[#8A6C4C]"
                      style={categoryError ? { border: '2px solid #D42A47' } : undefined}
                    >
                      <option value="">Выберите категорию</option>
                      {categories.map((category) => (
                        <option key={category._id} value={String(category._id)}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                      <Icon d="m6 9 6 6 6-6" size={20} stroke="#9CA3AF" />
                    </span>
                  </div>
                  {categoryError && (
                    <span className="text-sm leading-5 text-[#D42A47]">{categoryError}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel>
                    <span className="whitespace-nowrap">
                      Артикул / PLU <DemoTag />
                    </span>
                  </FieldLabel>
                  <input
                    disabled
                    placeholder="DP-0000"
                    title="Поля артикула пока нет в базе"
                    className={`${inputCls} cursor-not-allowed bg-gray-50 tabular-nums`}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  {/* Однострочная подпись: «Время приготовления» + чип не влезали
                      в колонку (~155px) и утаскивали инпут вниз — ломалась сетка */}
                  <FieldLabel>
                    <span className="whitespace-nowrap" title="Время приготовления">
                      Приготовление <DemoTag />
                    </span>
                  </FieldLabel>
                  <input
                    disabled
                    placeholder="12 мин"
                    title="Поля времени приготовления пока нет в базе"
                    className={`${inputCls} cursor-not-allowed bg-gray-50 tabular-nums`}
                  />
                </div>
              </div>
            </div>

            <div className="h-px flex-none bg-gray-200" />

            {/* Размеры и цены */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Размеры и цены</h3>
                {form.sizes.length > 0 && (
                  <span className="hidden text-sm leading-5 text-gray-600 sm:block">
                    Радио отмечает размер по умолчанию
                  </span>
                )}
              </div>

              {form.sizes.length === 0 ? (
                <div className="flex flex-col gap-1">
                  <FieldLabel>
                    Цена, € <span className="text-[#D42A47]">*</span>
                  </FieldLabel>
                  <input
                    value={form.basePrice}
                    onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                    placeholder="0,00"
                    inputMode="decimal"
                    required
                    aria-invalid={!!basePriceError}
                    className={`${inputCls} max-w-[148px] text-right font-bold tabular-nums`}
                    style={basePriceError ? { border: '2px solid #D42A47' } : undefined}
                  />
                  {basePriceError && (
                    <span className="text-sm leading-5 text-[#D42A47]">{basePriceError}</span>
                  )}
                </div>
              ) : (
                <>
                  <div className="hidden grid-cols-[1fr_148px_112px_44px] gap-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-400 sm:grid">
                    <span>Размер</span>
                    <span className="text-right">Цена, €</span>
                    <span className="whitespace-nowrap text-center">По умолчанию</span>
                    <span />
                  </div>
                  {form.sizes.map((size, i) => {
                    const isDefault = i === 0;
                    const badName = !size.name.trim();
                    const bad = !badName && !isValidPrice(size.price);
                    return (
                      <div
                        key={size.id}
                        className="grid grid-cols-[1fr_100px_44px] items-center gap-2 sm:grid-cols-[1fr_148px_112px_44px] sm:gap-3"
                      >
                        <input
                          value={size.name}
                          onChange={(e) => {
                            const sizes = [...form.sizes];
                            sizes[i] = { ...size, name: e.target.value };
                            setForm({ ...form, sizes });
                          }}
                          placeholder="Название размера"
                          aria-invalid={badName}
                          className={inputCls}
                          style={badName ? { border: '2px solid #D42A47' } : undefined}
                        />
                        <input
                          value={size.price}
                          onChange={(e) => {
                            const sizes = [...form.sizes];
                            sizes[i] = { ...size, price: e.target.value };
                            setForm({ ...form, sizes });
                          }}
                          placeholder="0,00"
                          inputMode="decimal"
                          aria-invalid={bad}
                          className={`${inputCls} text-right font-bold tabular-nums`}
                          style={bad ? { border: '2px solid #D42A47' } : undefined}
                        />
                        <div className="hidden items-center justify-center sm:flex">
                          <button
                            type="button"
                            aria-label="Размер по умолчанию"
                            title={isDefault ? 'Размер по умолчанию' : 'Сделать размером по умолчанию'}
                            onClick={() => {
                              if (isDefault) return;
                              const sizes = [...form.sizes];
                              const [picked] = sizes.splice(i, 1);
                              sizes.unshift(picked);
                              setForm({ ...form, sizes });
                            }}
                            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-2 bg-transparent"
                            style={{ borderColor: isDefault ? '#8A6C4C' : '#D1D5DB' }}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: isDefault ? '#8A6C4C' : 'transparent' }}
                            />
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label="Удалить размер"
                          title="Удалить размер"
                          onClick={() => {
                            const sizes = form.sizes.filter((_, idx) => idx !== i);
                            setForm({ ...form, sizes });
                          }}
                          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-gray-400 transition hover:bg-[#FDE6E7] hover:text-[#D42A47]"
                        >
                          <Icon d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13" size={20} />
                        </button>
                      </div>
                    );
                  })}
                  {sizeError && (
                    <span className="text-sm leading-5 text-[#D42A47]">{sizeError}</span>
                  )}
                </>
              )}

              {/* Добавить размер из библиотеки */}
              <div className="relative">
                <details className="group">
                  <summary className="flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#DCC9A9] text-base font-bold leading-5 text-[#7C6145] transition hover:bg-[#FAF7F2] [&::-webkit-details-marker]:hidden">
                    <Icon d="M5 12h14 M12 5v14" size={20} />
                    Добавить размер
                  </summary>
                  <div className="mt-2 flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-[0_8px_24px_rgba(17,24,39,.12)]">
                    {(variationsState.data?.variations || [])
                      .filter((variation) => variation.active !== false)
                      .filter(
                        (variation) =>
                          !form.sizes.some(
                            (size) => size.variationId === String(variation._id) || size.name === variation.name
                          )
                      )
                      .map((variation) => (
                        <button
                          key={variation._id}
                          type="button"
                          onClick={(e) => {
                            addSizeFromLibrary(variation);
                            (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                          }}
                          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-3 text-left text-base leading-6 text-gray-900 transition hover:bg-[#FAF7F2]"
                        >
                          {variation.name}
                          {variation.label && (
                            <span className="text-sm text-gray-500">· {variation.label}</span>
                          )}
                        </button>
                      ))}
                    <button
                      type="button"
                      onClick={(e) => {
                        setForm((prev) => ({
                          ...prev,
                          sizes: [
                            ...prev.sizes,
                            { id: `local-${Date.now()}`, name: '', label: '', price: '', active: true },
                          ],
                        }));
                        (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                      }}
                      className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-3 text-left text-base font-bold leading-6 text-[#7C6145] transition hover:bg-[#FAF7F2]"
                    >
                      <Icon d="M5 12h14 M12 5v14" size={16} />
                      Свой размер
                    </button>
                  </div>
                </details>
              </div>
            </div>

            <div className="h-px flex-none bg-gray-200" />

            {/* Группы опций */}
            <div className="flex flex-col gap-4">
              <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Группы опций</h3>
              {connectedGroups.length === 0 && (
                <span className="text-sm leading-5 text-gray-500">
                  К товару пока не подключены группы опций
                </span>
              )}
              {connectedGroups.map((group) => {
                const optionCount = (group.optionIds || []).length;
                const single = (group as any).maxSelect === 1;
                return (
                  <div
                    key={group._id}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 px-4"
                  >
                    <span
                      title="Порядок групп настраивается в разделе «Добавки»"
                      className="flex flex-none cursor-grab items-center text-gray-400"
                    >
                      <Icon d="M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01" size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold leading-6 text-gray-900">{group.name}</div>
                      <div className="text-sm leading-5 text-gray-600">
                        {optionCount} {plural(optionCount, 'опция', 'опции', 'опций')}
                        {(group as any).required ? ' · обязательная' : ''}
                        {(group as any).maxSelect > 1 ? ` · максимум ${(group as any).maxSelect}` : ''}
                      </div>
                    </div>
                    <span className="inline-flex h-6 flex-none items-center rounded-full bg-[#F5F0E8] px-2.5 text-xs font-bold leading-4 text-[#7C6145]">
                      {single ? 'один' : 'несколько'}
                    </span>
                    <Toggle
                      on
                      label="Отключить группу от товара"
                      onChange={() =>
                        setForm({
                          ...form,
                          optionGroupIds: form.optionGroupIds.filter(
                            (id) => id !== String(group._id)
                          ),
                        })
                      }
                    />
                  </div>
                );
              })}

              <div className="relative self-start">
                <button
                  type="button"
                  disabled={!availableGroups.length}
                  onClick={() => setGroupPickerOpen((prev) => !prev)}
                  className="h-10 cursor-pointer rounded-xl border-2 border-gray-900 bg-transparent px-4 text-base font-bold leading-5 text-gray-900 transition hover:bg-[#F5F0E8] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Подключить группу
                </button>
                {groupPickerOpen && (
                  <div className="absolute left-0 top-12 z-10 flex min-w-[280px] flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-[0_8px_24px_rgba(17,24,39,.12)]">
                    {availableGroups.map((group) => (
                      <button
                        key={group._id}
                        type="button"
                        onClick={() => {
                          setForm({
                            ...form,
                            optionGroupIds: [...form.optionGroupIds, String(group._id)],
                          });
                          setGroupPickerOpen(false);
                        }}
                        className="flex h-10 cursor-pointer items-center justify-between gap-3 rounded-lg border-none bg-transparent px-3 text-left text-base leading-6 text-gray-900 transition hover:bg-[#FAF7F2]"
                      >
                        {group.name}
                        <span className="text-sm text-gray-500">
                          {(group.optionIds || []).length} опц.
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="h-px flex-none bg-gray-200" />

            {/* Состав и аллергены — бэкенда пока нет */}
            <div className="flex flex-col gap-4">
              <h3 className="m-0 flex items-center gap-2 text-lg font-bold leading-6 text-gray-900">
                Состав и аллергены <DemoTag />
              </h3>
              <div className="flex flex-col gap-1">
                <FieldLabel>Ингредиенты</FieldLabel>
                <textarea
                  disabled
                  placeholder="Перечислите ингредиенты через запятую"
                  title="Полей состава пока нет в базе — появятся вместе с аллергенами"
                  className="min-h-[72px] w-full cursor-not-allowed resize-none rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-base leading-6 outline-none placeholder:text-gray-400"
                />
              </div>
              <div className="flex flex-col gap-2">
                <FieldLabel>Аллергены</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {['A · Gluten', 'C · Milch', 'J · Senf'].map((allergen) => (
                    <span
                      key={allergen}
                      className="inline-flex h-8 items-center gap-2 rounded-full bg-[#FEF9C3] px-3 text-sm font-bold leading-5 text-[#713F12] opacity-60"
                    >
                      {allergen}
                    </span>
                  ))}
                  <span className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full border-2 border-dashed border-[#DCC9A9] px-3 text-sm font-bold leading-5 text-[#7C6145] opacity-60">
                    <Icon d="M5 12h14 M12 5v14" size={14} />
                    Добавить аллерген
                  </span>
                </div>
              </div>
            </div>

            <div className="h-px flex-none bg-gray-200" />

            {/* Налоги */}
            <div className="flex flex-col gap-3 pb-2">
              <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Налоги</h3>
              {/*
               * Подписи из lib/orders/tax.ts: 7 % — еда (Speisen), 19 % — ТОЛЬКО
               * вода и алкоголь (безалкогольные напитки, кроме воды, тоже 7 %).
               * Сегменты равной ширины — контрол не «раздувается» длинной подписью.
               */}
              <div className="grid w-full max-w-[440px] grid-cols-2 items-center gap-1 rounded-full bg-gray-100 p-1">
                {[
                  { rate: FOOD_VAT, label: '7 % · Speisen' },
                  { rate: BEVERAGE_VAT, label: '19 % · Wasser & Alkohol' },
                ].map((tax) => (
                  <button
                    key={tax.rate}
                    type="button"
                    onClick={() => setForm({ ...form, taxRate: tax.rate })}
                    className={
                      form.taxRate === tax.rate
                        ? 'inline-flex h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-none bg-[#8A6C4C] px-3 text-base font-bold leading-5 text-white'
                        : 'inline-flex h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border-none bg-transparent px-3 text-base font-bold leading-5 text-gray-600'
                    }
                  >
                    {tax.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Футер */}
        <div className="flex h-[72px] flex-none items-center gap-2 border-t border-gray-200 bg-white px-3 shadow-[0_-2px_12px_rgba(17,24,39,.08)] lg:gap-3 lg:px-6">
          {!isNew && (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="h-12 cursor-pointer whitespace-nowrap rounded-xl border-none bg-transparent px-2 text-base font-bold leading-5 text-[#D42A47] transition hover:bg-[#FDE6E7] disabled:opacity-50 lg:px-4"
            >
              {deleting ? 'Удаляем…' : (
                <>
                  Удалить<span className="hidden sm:inline"> товар</span>
                </>
              )}
            </button>
          )}
          {/* Причина недоступности «Сохранить» — первая ошибка формы */}
          <span
            className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm font-bold leading-5 text-[#D42A47]"
            title={firstError ?? undefined}
          >
            {firstError}
          </span>
          <button
            type="button"
            onClick={attemptClose}
            className="h-12 flex-none cursor-pointer whitespace-nowrap rounded-xl border-2 border-gray-900 bg-transparent px-4 text-base font-bold leading-5 text-gray-900 transition hover:bg-[#F5F0E8] lg:min-w-[96px] lg:px-6 lg:text-lg"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={saving || hasErrors}
            title={hasErrors ? firstError ?? undefined : undefined}
            onClick={handleSave}
            className="h-12 flex-none cursor-pointer whitespace-nowrap rounded-xl border-none bg-[#8A6C4C] px-4 text-base font-bold leading-5 text-white shadow-[0_1px_2px_rgba(95,73,52,.24)] transition hover:bg-[#7C6145] hover:shadow-[0_4px_12px_rgba(95,73,52,.28)] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 lg:min-w-[96px] lg:px-6 lg:text-lg"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>

        <UnsavedAlert
          open={unsavedOpen}
          changedHint={changedHint}
          onDiscard={() => {
            setUnsavedOpen(false);
            onClose();
          }}
          onContinue={() => setUnsavedOpen(false)}
        />
      </div>
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
