"use client";

import { useEffect, useState } from 'react';
import {
  GalleryHorizontalEnd,
  Loader2,
  Plus,
  Save,
  Trash2,
  ArrowUp,
  ArrowDown,
  CalendarDays,
} from 'lucide-react';
import StatusModal from '../../../components/admin/StatusModal';
import ImageUpload from '../../../components/ImageUpload';
import { SafeImage } from '../../../components/SafeImage';
import {
  ALL_WEEKDAYS,
  WEEKDAY_OPTIONS,
  formatWeekdayLabel,
  resolveActiveDays,
} from '../../../lib/banners/visibility';

interface Banner {
  _id: string;
  title: string;
  subtitle: string | null;
  image: string;
  linkUrl: string | null;
  badgeText: string | null;
  enabled: boolean;
  order: number;
  activeDaysOfWeek: number[];
}

const EMPTY_DRAFT = {
  title: '',
  subtitle: '',
  image: '',
  linkUrl: '',
  badgeText: '',
  activeDaysOfWeek: [...ALL_WEEKDAYS],
  // Neue Banner sind Entwürfe: sonst stünde ein halbfertiger Banner sofort
  // live auf der Startseite (Admin und Live-Seite teilen sich die Datenbank).
  enabled: false,
};

/** Расписание показа по дням недели — «2+1 по понедельникам» без правок каждую неделю. */
export function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const isEveryDay = value.length === 7;

  const toggle = (day: number) => {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm text-gray-600">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        Дни показа
        {!isEveryDay && (
          <button
            type="button"
            onClick={() => onChange([...ALL_WEEKDAYS])}
            className="text-xs text-primary-600 underline hover:text-primary-700"
          >
            каждый день
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Дни показа баннера">
        {WEEKDAY_OPTIONS.map((day) => {
          const active = value.includes(day.value);
          return (
            <button
              key={day.value}
              type="button"
              onClick={() => toggle(day.value)}
              aria-pressed={active}
              className={`w-11 rounded-lg border px-2 py-1.5 text-sm transition ${
                active
                  ? 'border-primary-600 bg-primary-600 font-medium text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {day.labelRu}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-gray-400">
        {value.length === 0
          ? 'Ничего не выбрано — баннер будет показываться каждый день'
          : isEveryDay
            ? 'Показывается каждый день'
            : `Только ${formatWeekdayLabel(value)} — остальные дни баннер скрыт`}
      </p>
    </div>
  );
}

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    message: '',
  });

  const load = async () => {
    try {
      const res = await fetch('/api/banners?admin=1');
      const data = await res.json();
      if (data.success) setBanners(data.banners || []);
      else setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось загрузить' });
    } catch (e: any) {
      setModal({ open: true, title: 'Ошибка', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!draft.title.trim() || !draft.image.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/banners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (data.success) {
        setBanners((prev) => [...prev, data.banner]);
        setDraft({ ...EMPTY_DRAFT });
      } else {
        setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось создать' });
      }
    } catch (e: any) {
      setModal({ open: true, title: 'Ошибка', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const updateField = (id: string, field: keyof Banner, value: any) => {
    setBanners((prev) => prev.map((b) => (b._id === id ? { ...b, [field]: value } : b)));
  };

  const save = async (banner: Banner) => {
    try {
      const res = await fetch(`/api/banners/${banner._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: banner.title,
          subtitle: banner.subtitle ?? '',
          image: banner.image,
          linkUrl: banner.linkUrl ?? '',
          badgeText: banner.badgeText ?? '',
          enabled: banner.enabled,
          order: banner.order,
          activeDaysOfWeek: resolveActiveDays(banner.activeDaysOfWeek),
        }),
      });
      const data = await res.json();
      if (data.success) setModal({ open: true, title: 'Готово', message: 'Баннер сохранён' });
      else setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось сохранить' });
    } catch (e: any) {
      setModal({ open: true, title: 'Ошибка', message: e.message });
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить баннер со слайдера главной?')) return;
    try {
      const res = await fetch(`/api/banners/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) setBanners((prev) => prev.filter((b) => b._id !== id));
      else setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось удалить' });
    } catch (e: any) {
      setModal({ open: true, title: 'Ошибка', message: e.message });
    }
  };

  /**
   * Перестановка соседей: меняем order местами и сохраняем ОБА баннера —
   * иначе на главной порядок разъедется с тем, что видно в админке.
   */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= banners.length) return;

    const reordered = [...banners];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const withOrder = reordered.map((b, i) => ({ ...b, order: i }));
    setBanners(withOrder);

    await Promise.all(
      [withOrder[index], withOrder[target]].map((b) =>
        fetch(`/api/banners/${b._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: b.order }),
        })
      )
    );
  };

  return (
    <div className="max-w-5xl p-6">
      <div className="mb-2 flex items-center gap-2">
        <GalleryHorizontalEnd className="h-6 w-6 text-primary-600" />
        <h1 className="text-2xl font-bold">Баннеры главной</h1>
      </div>
      <p className="mb-6 text-gray-500">
        Рекламная лента под шапкой главной страницы. Порядок задаётся стрелками, дни показа —
        кнопками Пн–Вс (расписание повторяется каждую неделю, время берлинское). Первый баннер
        грузится с приоритетом, поэтому ставьте в начало самый важный оффер.
      </p>

      {/* Добавить новый */}
      <div className="mb-6 rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">Новый баннер</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Заголовок (напр. 2+1 auf alle Pizzen)"
              className="w-full rounded-lg border px-3 py-2"
            />
            <input
              type="text"
              value={draft.subtitle}
              onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              placeholder="Подзаголовок (необязательно)"
              className="w-full rounded-lg border px-3 py-2"
            />
            <input
              type="text"
              value={draft.linkUrl}
              onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
              placeholder="Ссылка (напр. /angebote/2-plus-1)"
              className="w-full rounded-lg border px-3 py-2"
            />
            <input
              type="text"
              value={draft.badgeText}
              onChange={(e) => setDraft({ ...draft, badgeText: e.target.value })}
              placeholder="Плашка (напр. NEU)"
              className="w-full rounded-lg border px-3 py-2"
            />
            <WeekdayPicker
              value={draft.activeDaysOfWeek}
              onChange={(days) => setDraft({ ...draft, activeDaysOfWeek: days })}
            />
          </div>
          <div>
            <ImageUpload
              value={draft.image}
              onChange={(url) => setDraft({ ...draft, image: url })}
              label="Картинка баннера (широкая, напр. 1600×900)"
              folder="banners"
            />
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          Сразу показывать на главной
          <span className="text-gray-400">
            — иначе баннер сохранится черновиком и на сайте не появится
          </span>
        </label>
        <button
          type="button"
          onClick={create}
          disabled={!draft.title.trim() || !draft.image.trim() || saving}
          className="mt-3 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить баннер
        </button>
      </div>

      {/* Список */}
      <div className="rounded-xl border bg-white">
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          </div>
        ) : banners.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Пока нет баннеров — слайдер на главной не показывается.
          </div>
        ) : (
          <div className="divide-y">
            {banners.map((banner, index) => (
              <div key={banner._id} className="flex flex-col gap-4 p-4 md:flex-row">
                <SafeImage
                  src={banner.image}
                  alt={banner.title}
                  className="h-24 w-full rounded-lg border object-cover md:w-44"
                />

                <div className="grid flex-1 gap-2 md:grid-cols-2">
                  <input
                    type="text"
                    value={banner.title}
                    onChange={(e) => updateField(banner._id, 'title', e.target.value)}
                    className="rounded-lg border px-3 py-2"
                    placeholder="Заголовок"
                  />
                  <input
                    type="text"
                    value={banner.subtitle ?? ''}
                    onChange={(e) => updateField(banner._id, 'subtitle', e.target.value)}
                    className="rounded-lg border px-3 py-2"
                    placeholder="Подзаголовок"
                  />
                  <input
                    type="text"
                    value={banner.linkUrl ?? ''}
                    onChange={(e) => updateField(banner._id, 'linkUrl', e.target.value)}
                    className="rounded-lg border px-3 py-2"
                    placeholder="Ссылка"
                  />
                  <input
                    type="text"
                    value={banner.badgeText ?? ''}
                    onChange={(e) => updateField(banner._id, 'badgeText', e.target.value)}
                    className="rounded-lg border px-3 py-2"
                    placeholder="Плашка"
                  />
                  <div className="md:col-span-2">
                    <WeekdayPicker
                      value={resolveActiveDays(banner.activeDaysOfWeek)}
                      onChange={(days) => updateField(banner._id, 'activeDaysOfWeek', days)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={banner.enabled}
                      onChange={(e) => updateField(banner._id, 'enabled', e.target.checked)}
                    />
                    Показывать на главной
                  </label>
                </div>

                <div className="flex shrink-0 flex-row gap-2 md:flex-col">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="text-gray-500 hover:text-gray-800 disabled:opacity-30"
                    title="Выше"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === banners.length - 1}
                    className="text-gray-500 hover:text-gray-800 disabled:opacity-30"
                    title="Ниже"
                  >
                    <ArrowDown className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => save(banner)}
                    className="text-primary-600 hover:text-primary-700"
                    title="Сохранить"
                  >
                    <Save className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(banner._id)}
                    className="text-red-600 hover:text-red-700"
                    title="Удалить"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <StatusModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={() => setModal({ open: false, message: '' })}
      />
    </div>
  );
}
