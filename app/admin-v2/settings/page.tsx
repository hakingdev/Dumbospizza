'use client';

/**
 * Настройки (канва D9, узел 28:937): вкладки «Пользователи и права» /
 * «Аккаунт» / «Уведомления» + реквизиты заведения (storeName/phone/email/
 * address из storeSettings) с save-bar, считающим изменённые поля.
 * Пользователи — реальный список; язык и автопечать — заглушки.
 */

import { signOut, useSession } from 'next-auth/react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  patchStoreSettings,
  useJson,
  useStoreSettings,
} from '../../../components/admin-v2/hooks';
import { initials } from '../../../components/admin-v2/format';
import { isSoundEnabled, playNewOrderBeep, setSoundEnabled } from '../../../components/admin-v2/sound';
import { Card, DemoTag, ErrorBanner, Icon, LoadError, Loading, TabPill, btnOutline, btnPrimary } from '../../../components/admin-v2/ui';

const ROLE_LABELS: Record<string, { role: string; access: string }> = {
  admin: { role: 'Администратор', access: 'Все разделы' },
  staff: { role: 'Персонал', access: 'Заказы, Меню' },
};

const TABS = [
  { key: 'users', label: 'Пользователи и права' },
  { key: 'account', label: 'Аккаунт' },
  { key: 'notifications', label: 'Уведомления' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Реквизиты заведения из канвы D9 — все ключи реально живут в storeSettings. */
const ACCOUNT_FIELDS = [
  { key: 'storeName', label: 'Название заведения' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'E-Mail для чеков' },
  { key: 'address', label: 'Адрес' },
] as const;

type AccountForm = Record<(typeof ACCOUNT_FIELDS)[number]['key'], string>;

function baselineFrom(settings: Record<string, any>): AccountForm {
  return {
    storeName: settings.storeName || 'Dumbos Pizza',
    phone: settings.phone || '',
    email: settings.email || '',
    address: settings.address || '',
  };
}

function pluralFields(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'поле';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'поля';
  return 'полей';
}

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

function SettingsPageInner() {
  const { data: session } = useSession();
  const store = useStoreSettings();
  const usersState = useJson<{ users: any[] }>(`/api/users?limit=50`);
  const staffUsers = (usersState.data?.users ?? []).filter(
    (user) => user.role === 'admin' || user.role === 'staff'
  );

  const [tab, setTab] = useState<TabKey>('users');
  const [form, setForm] = useState<AccountForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => setSound(isSoundEnabled()), []);
  useEffect(() => {
    if (store.settings && !form) setForm(baselineFrom(store.settings));
  }, [store.settings, form]);

  const baseline = useMemo(
    () => (store.settings ? baselineFrom(store.settings) : null),
    [store.settings]
  );
  const dirtyKeys =
    form && baseline
      ? ACCOUNT_FIELDS.map((field) => field.key).filter((key) => form[key] !== baseline[key])
      : [];

  const handleSave = async () => {
    if (!form || !dirtyKeys.length) return;
    setSaving(true);
    const patch = Object.fromEntries(dirtyKeys.map((key) => [key, form[key]]));
    const ok = await patchStoreSettings(patch);
    setSaving(false);
    if (!ok) {
      alert('Не удалось сохранить (нужны права администратора)');
      return;
    }
    store.reload();
  };

  const toggleSound = (next: boolean) => {
    setSound(next);
    setSoundEnabled(next);
    if (next) playNewOrderBeep();
  };

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
          Настройки
        </h1>
        <p className="m-0 text-base leading-6 text-gray-600">Пользователи и права · аккаунт · выход</p>
      </div>

      {store.error && !store.settings && (
        <ErrorBanner
          text="Настройки заведения не загрузились — реквизиты показаны по умолчанию, сохранение недоступно"
          onRetry={store.reload}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <TabPill
            key={item.key}
            label={item.label}
            active={tab === item.key}
            onClick={() => setTab(item.key)}
          />
        ))}
      </div>

      {tab === 'users' && (
        <Card>
          <div className="flex flex-col gap-3 border-b border-gray-200 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:p-6">
            <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Пользователи и права
            </h2>
            <button
              type="button"
              disabled
              title="Приглашения появятся вместе с ролевой моделью — пока пользователей создаёт разработчик"
              className={`${btnOutline} h-10 px-4 text-base`}
            >
              Пригласить пользователя
            </button>
          </div>
          <div className="hidden grid-cols-[1fr_160px_160px_100px] gap-4 border-b border-gray-200 bg-gray-100 px-6 py-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600 lg:grid">
            <span>Пользователь</span>
            <span>Роль</span>
            <span>Доступ</span>
            <span className="text-right">Статус</span>
          </div>
          {usersState.loading && !usersState.data ? (
            <Loading />
          ) : usersState.error && !usersState.data ? (
            <LoadError
              framed={false}
              title="Пользователи не загрузились"
              detail={usersState.error}
              onRetry={usersState.reload}
            />
          ) : staffUsers.length ? (
            staffUsers.map((user, i) => {
              const meta = ROLE_LABELS[user.role] || { role: user.role, access: '—' };
              const isSelf = user.email === session?.user?.email;
              return (
                <div
                  key={user._id || user.email}
                  className={`flex flex-wrap items-center gap-3 px-4 py-4 transition hover:bg-[#FAF7F2] lg:grid lg:grid-cols-[1fr_160px_160px_100px] lg:gap-4 lg:px-6 ${
                    i === staffUsers.length - 1 ? '' : 'border-b border-gray-200'
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none">
                    <span
                      className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold ${
                        isSelf ? 'bg-[#EBE4D8] text-[#7C6145]' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {initials(user.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-6 text-gray-900">
                        {user.name || '—'}
                        {isSelf ? ' (вы)' : ''}
                      </span>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
                        {user.email}
                      </span>
                    </span>
                  </span>
                  <span className="text-base leading-6 text-gray-900">{meta.role}</span>
                  <span className="hidden text-sm leading-5 text-gray-600 lg:block">{meta.access}</span>
                  <span className="ml-auto flex lg:ml-0 lg:justify-end">
                    <span className="inline-flex h-6 items-center rounded-full bg-[#DCFCE7] px-2.5 text-xs font-bold leading-4 text-[#15803D]">
                      Активен
                    </span>
                  </span>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-gray-500">Пользователей с доступом пока нет</div>
          )}
        </Card>
      )}

      {tab === 'account' && (
        <>
          <Card className="flex flex-col gap-4 p-4 lg:p-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {ACCOUNT_FIELDS.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-sm font-bold leading-5 text-gray-900">{field.label}</span>
                  <input
                    value={form?.[field.key] ?? ''}
                    disabled={!form}
                    onChange={(e) =>
                      setForm((prev) => (prev ? { ...prev, [field.key]: e.target.value } : prev))
                    }
                    className="h-12 rounded-xl border border-gray-300 bg-white px-4 text-base leading-6 text-gray-900 outline-none transition focus:border-[#8A6C4C] disabled:cursor-not-allowed disabled:bg-gray-100"
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-1 border-t border-gray-200 pt-4">
              <span className="flex items-center gap-2 text-sm font-bold leading-5 text-gray-900">
                Язык интерфейса <DemoTag />
              </span>
              <div className="flex max-w-md gap-2">
                {['RU', 'DE', 'EN'].map((lang, i) => (
                  <span
                    key={lang}
                    title={i === 0 ? 'Текущий язык' : 'Перевод портала появится позже'}
                    className={
                      i === 0
                        ? 'inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-[#8A6C4C] text-base font-bold leading-5 text-white'
                        : 'inline-flex h-12 flex-1 cursor-not-allowed items-center justify-center rounded-xl border border-gray-300 bg-white text-base font-bold leading-5 text-gray-400'
                    }
                  >
                    {lang}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/admin/login' })}
            className="flex h-10 cursor-pointer items-center justify-center gap-2 self-start rounded-xl border-none bg-transparent px-4 text-base font-bold leading-5 text-[#D42A47] transition hover:bg-[#FDE6E7]"
          >
            <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9" size={20} />
            Выйти из аккаунта
          </button>
        </>
      )}

      {tab === 'notifications' && (
        <Card className="flex flex-col gap-4 p-4 lg:p-6">
          <div className="flex items-center gap-4">
            <span className="flex-1 text-base leading-6 text-gray-900">Звук нового заказа</span>
            <Toggle
              on={sound}
              label={sound ? 'Выключить звук' : 'Включить звук'}
              onChange={toggleSound}
            />
          </div>
          <div className="flex items-center gap-4 border-t border-gray-200 pt-4">
            <span className="flex flex-1 items-center gap-2 text-base leading-6 text-gray-900">
              Автопечать на кухню <DemoTag />
            </span>
            <Toggle on disabled label="Печать чеков сейчас всегда автоматическая — переключатель появится вместе с настройкой принт-агента" />
          </div>
        </Card>
      )}

      {/* Sticky-панель сохранения (D9): счётчик изменённых полей */}
      {dirtyKeys.length > 0 && (
        <div className="fixed inset-x-0 bottom-[72px] z-40 flex items-center gap-3 bg-white px-4 py-3 shadow-[0_-2px_12px_rgba(17,24,39,.08)] lg:bottom-0 lg:left-[112px] lg:h-[72px] lg:px-8 lg:py-0">
          <span className="hidden min-w-0 flex-1 text-base font-bold leading-6 text-gray-900 lg:block">
            Есть несохранённые изменения · {dirtyKeys.length} {pluralFields(dirtyKeys.length)}
          </span>
          <div className="flex-1 lg:hidden" />
          <button
            type="button"
            onClick={() => baseline && setForm(baseline)}
            className="h-12 cursor-pointer whitespace-nowrap rounded-xl border-none bg-transparent px-6 text-lg font-bold leading-5 text-gray-900 transition hover:bg-[#FAF7F2]"
          >
            Отменить
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className={`${btnPrimary} h-12 whitespace-nowrap px-6 text-lg`}
          >
            {saving ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsPageInner />
    </Suspense>
  );
}
