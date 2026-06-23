'use client';

import { useState } from 'react';
import {
  User as UserIcon,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Edit,
  LogOut,
  Loader2,
} from 'lucide-react';

interface ProfileTabProps {
  user: any;
  onUpdated: (user: any) => void;
  onLogout: () => void;
}

export default function ProfileTab({
  user,
  onUpdated,
  onLogout,
}: ProfileTabProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/customer/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Fehler');
      onUpdated(data.user);
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const regDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-4 shadow sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold leading-tight">
            Persönliche Daten
          </h2>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex shrink-0 items-center whitespace-nowrap text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <Edit className="mr-1 h-4 w-4 shrink-0" /> Bearbeiten
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-primary-500"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={saving}
                className="flex min-h-[40px] flex-1 items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium leading-none text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving && (
                  <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                )}
                Speichern
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setName(user.name || '');
                  setEmail(user.email || '');
                  setError(null);
                }}
                className="min-h-[40px] flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium leading-none text-gray-700 hover:bg-gray-50"
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex min-w-0 items-center text-gray-700">
              <UserIcon className="mr-3 h-5 w-5 shrink-0 text-gray-400" />
              <span className="min-w-0 truncate font-medium">
                {user.name || '—'}
              </span>
            </div>
            <div className="flex min-w-0 items-center text-gray-700">
              <Mail className="mr-3 h-5 w-5 shrink-0 text-gray-400" />
              <span className="min-w-0 truncate">{user.email || '—'}</span>
            </div>
            <div className="flex min-w-0 items-center text-gray-700">
              <Phone className="mr-3 h-5 w-5 shrink-0 text-gray-400" />
              <span className="min-w-0 truncate">{user.phoneNumber}</span>
            </div>
            <div className="flex min-w-0 items-center text-gray-700">
              <Calendar className="mr-3 h-5 w-5 shrink-0 text-gray-400" />
              <span className="min-w-0 truncate">Mitglied seit {regDate}</span>
            </div>
          </div>
        )}
      </div>

      {/* Addresses */}
      <div className="rounded-lg bg-white p-4 shadow sm:p-6">
        <h2 className="mb-4 text-lg font-semibold leading-tight">
          Lieferadressen
        </h2>
        {Array.isArray(user.addresses) && user.addresses.length > 0 ? (
          <ul className="space-y-2">
            {user.addresses.map((a: any, i: number) => (
              <li
                key={i}
                className="flex min-w-0 items-start text-sm leading-6 text-gray-700"
              >
                <MapPin className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0 break-words">
                  {a.street} {a.houseNumber}, {a.postalCode} {a.city}
                  {a.floor ? `, ${a.floor}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-pretty text-sm leading-6 text-gray-500">
            Noch keine gespeicherten Adressen. Sie werden bei Ihrer nächsten
            Bestellung ergänzt.
          </p>
        )}
      </div>

      <button
        onClick={onLogout}
        className="inline-flex items-center whitespace-nowrap text-sm font-medium text-gray-600 hover:text-red-600"
      >
        <LogOut className="mr-2 h-4 w-4 shrink-0" /> Abmelden
      </button>
    </div>
  );
}
