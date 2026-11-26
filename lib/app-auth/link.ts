/**
 * Ссылки из писем Supabase-проекта ПРИЛОЖЕНИЯ Dumbo Slice (не проекта сайта):
 * подтверждение регистрации и сброс пароля. Письмо ведёт на /app-auth, а не
 * сразу в приложение: почтовики часто открывают ссылки в Safari или на
 * компьютере без приложения. Страница сама подтверждает аккаунт / ставит новый
 * пароль и только потом предлагает открыть приложение.
 *
 * Что приходит на страницу:
 *  - ?token_hash=…&type=email|signup|recovery — из наших шаблонов писем
 *    (docs/auth-email-setup.md в репозитории приложения);
 *  - #access_token=…&refresh_token=…&type=signup|recovery — если в шаблоне
 *    остался стандартный {{ .ConfirmationURL }}: Supabase уже подтвердил и
 *    отдал сессию во фрагменте;
 *  - #error=…&error_code=…&error_description=… — истёкшая/использованная ссылка.
 */

export const APP_CALLBACK_URL = 'dumbospizza://auth/callback'
export const APP_SIGN_IN_URL = 'dumbospizza://sign-in'
export const MIN_PASSWORD_LENGTH = 8

export type AppAuthIntent =
  | { kind: 'confirm-token'; tokenHash: string; type: 'email' | 'signup' }
  | { kind: 'recovery-token'; tokenHash: string }
  | { kind: 'confirmed-session'; accessToken: string; refreshToken: string }
  | { kind: 'recovery-session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; code: string; description: string | null }
  | { kind: 'invalid' }

function params(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[?#]/, ''))
}

export function parseAppAuthParams(search: string, hash: string): AppAuthIntent {
  const q = params(search)
  const h = params(hash)
  const get = (key: string) => h.get(key) || q.get(key) || null

  const error = get('error_code') || get('error')
  if (error) return { kind: 'error', code: error, description: get('error_description') }

  const type = get('type')
  const accessToken = get('access_token')
  const refreshToken = get('refresh_token')
  if (accessToken && refreshToken) {
    return type === 'recovery'
      ? { kind: 'recovery-session', accessToken, refreshToken }
      : { kind: 'confirmed-session', accessToken, refreshToken }
  }

  const tokenHash = get('token_hash')
  if (tokenHash) {
    if (type === 'recovery') return { kind: 'recovery-token', tokenHash }
    if (type === 'email' || type === 'signup') return { kind: 'confirm-token', tokenHash, type }
  }
  return { kind: 'invalid' }
}

/** Открыть приложение уже вошедшим: токены во фрагменте, чтобы не уходили в логи/Referer. */
export function buildAppCallbackUrl(session: { access_token: string; refresh_token: string }): string {
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    type: 'signup',
  })
  return `${APP_CALLBACK_URL}#${fragment.toString()}`
}

export function appAuthErrorMessage(code: string | null, description: string | null): string {
  const text = `${code ?? ''} ${description ?? ''}`.toLowerCase()
  if (text.includes('expired') || text.includes('invalid') || text.includes('otp') || text.includes('not found'))
    return 'Dieser Link ist abgelaufen oder wurde schon benutzt. Ist dein Konto bereits bestätigt, melde dich einfach in der App an.'
  if (text.includes('same') && text.includes('password'))
    return 'Das neue Passwort muss sich vom alten unterscheiden.'
  if (text.includes('weak') || text.includes('password'))
    return `Das Passwort ist zu schwach. Mindestens ${MIN_PASSWORD_LENGTH} Zeichen verwenden.`
  if (text.includes('fetch') || text.includes('network'))
    return 'Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.'
  return 'Etwas ist schiefgelaufen. Bitte versuche es erneut.'
}
