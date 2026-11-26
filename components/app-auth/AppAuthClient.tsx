'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import {
  APP_SIGN_IN_URL,
  MIN_PASSWORD_LENGTH,
  appAuthErrorMessage,
  buildAppCallbackUrl,
  parseAppAuthParams,
  type AppAuthIntent,
} from '../../lib/app-auth/link'

/**
 * Подтверждение аккаунта / новый пароль для приложения Dumbo Slice (см. lib/app-auth/link).
 * Работает в браузере без приложения. Подтверждение идёт из JS после загрузки, а сброс
 * пароля — только по нажатию: почтовые сканеры, открывающие ссылки заранее, одноразовый
 * токен так не «съедят».
 */

type View =
  | { step: 'working' }
  | { step: 'confirmed'; appUrl: string }
  | { step: 'password'; intent: Extract<AppAuthIntent, { kind: 'recovery-token' | 'recovery-session' }> }
  | { step: 'password-changed' }
  | { step: 'failed'; message: string }

function appClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

const NOT_CONFIGURED = 'Die Bestätigung ist gerade nicht verfügbar. Bitte versuche es später erneut.'

export default function AppAuthClient() {
  const [view, setView] = useState<View>({ step: 'working' })
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const client = useRef<SupabaseClient | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const intent = parseAppAuthParams(window.location.search, window.location.hash)
    // Токены не оставляем в адресной строке и истории.
    window.history.replaceState(null, '', window.location.pathname)

    client.current = appClient()
    const supabase = client.current

    if (intent.kind === 'error') return setView({ step: 'failed', message: appAuthErrorMessage(intent.code, intent.description) })
    if (intent.kind === 'invalid') return setView({ step: 'failed', message: appAuthErrorMessage('invalid', null) })
    if (intent.kind === 'confirmed-session') {
      return setView({
        step: 'confirmed',
        appUrl: buildAppCallbackUrl({ access_token: intent.accessToken, refresh_token: intent.refreshToken }),
      })
    }
    if (intent.kind === 'recovery-token' || intent.kind === 'recovery-session') return setView({ step: 'password', intent })

    if (!supabase) return setView({ step: 'failed', message: NOT_CONFIGURED })
    supabase.auth
      .verifyOtp({ token_hash: intent.tokenHash, type: intent.type })
      .then(({ data, error }) => {
        if (error || !data.session) {
          return setView({ step: 'failed', message: appAuthErrorMessage(error?.code ?? null, error?.message ?? null) })
        }
        setView({ step: 'confirmed', appUrl: buildAppCallbackUrl(data.session) })
      })
      .catch((error: unknown) => setView({ step: 'failed', message: appAuthErrorMessage(null, String(error)) }))
  }, [])

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (view.step !== 'password') return
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setFormError(`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen verwenden.`)
    }
    const supabase = client.current
    if (!supabase) return setFormError(NOT_CONFIGURED)

    setBusy(true)
    setFormError(null)
    try {
      const intent = view.intent
      const { error: sessionError } =
        intent.kind === 'recovery-token'
          ? await supabase.auth.verifyOtp({ token_hash: intent.tokenHash, type: 'recovery' })
          : await supabase.auth.setSession({ access_token: intent.accessToken, refresh_token: intent.refreshToken })
      if (sessionError) {
        return setView({ step: 'failed', message: appAuthErrorMessage(sessionError.code ?? null, sessionError.message) })
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        // Токен уже потрачен; сессия в этом клиенте есть, так что можно попробовать другой пароль.
        if (intent.kind === 'recovery-token') {
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            setView({
              step: 'password',
              intent: {
                kind: 'recovery-session',
                accessToken: data.session.access_token,
                refreshToken: data.session.refresh_token,
              },
            })
          }
        }
        return setFormError(appAuthErrorMessage(error.code ?? null, error.message))
      }
      await supabase.auth.signOut({ scope: 'local' })
      setView({ step: 'password-changed' })
    } catch (error) {
      setFormError(appAuthErrorMessage(null, String(error)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-md">
        <p className="mb-4 text-sm font-medium uppercase tracking-wide text-[#8a6942]">Dumbo Slice</p>

        {view.step === 'working' && <p className="text-gray-700">Einen Moment, wir prüfen deinen Link …</p>}

        {view.step === 'confirmed' && (
          <>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">Dein Konto ist bestätigt.</h1>
            <p className="mb-6 text-gray-700">Schön, dass du da bist! Öffne jetzt die App, du bist dort direkt angemeldet.</p>
            <a
              href={view.appUrl}
              className="block w-full rounded-full bg-[#8a6942] px-4 py-3 text-center font-semibold text-white"
            >
              In Dumbo Slice öffnen
            </a>
            <p className="mt-4 text-sm text-gray-500">
              Die App ist nicht auf diesem Gerät? Kein Problem: Öffne Dumbo Slice auf deinem iPhone und melde dich mit
              deiner E-Mail-Adresse und deinem Passwort an.
            </p>
          </>
        )}

        {view.step === 'password' && (
          <form onSubmit={savePassword} noValidate>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">Neues Passwort</h1>
            <p className="mb-4 text-gray-700">Wähle ein neues Passwort für dein Dumbo-Konto.</p>
            <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">
              Neues Passwort
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setFormError(null)
              }}
              className="mb-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:border-[#8a6942] focus:outline-none"
            />
            <p className={`mb-4 text-sm ${formError ? 'text-red-600' : 'text-gray-500'}`} role={formError ? 'alert' : undefined}>
              {formError ?? `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen verwenden.`}
            </p>
            <button
              type="submit"
              disabled={busy}
              className="block w-full rounded-full bg-[#8a6942] px-4 py-3 text-center font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Wird gespeichert …' : 'Passwort speichern'}
            </button>
          </form>
        )}

        {view.step === 'password-changed' && (
          <>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">Passwort geändert.</h1>
            <p className="mb-6 text-gray-700">Melde dich jetzt in der App mit deinem neuen Passwort an.</p>
            <a
              href={APP_SIGN_IN_URL}
              className="block w-full rounded-full bg-[#8a6942] px-4 py-3 text-center font-semibold text-white"
            >
              Zur App
            </a>
          </>
        )}

        {view.step === 'failed' && (
          <>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">Das hat nicht geklappt.</h1>
            <p className="mb-6 text-gray-700">{view.message}</p>
            <a
              href={APP_SIGN_IN_URL}
              className="block w-full rounded-full bg-[#8a6942] px-4 py-3 text-center font-semibold text-white"
            >
              Zur App
            </a>
          </>
        )}
      </div>
    </main>
  )
}
