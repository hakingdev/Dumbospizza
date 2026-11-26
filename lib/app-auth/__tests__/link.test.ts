import { describe, expect, it } from 'vitest'
import { appAuthErrorMessage, buildAppCallbackUrl, parseAppAuthParams } from '../link'

describe('parseAppAuthParams', () => {
  it('reads a signup token_hash from the query', () => {
    expect(parseAppAuthParams('?token_hash=abc&type=email', '')).toEqual({
      kind: 'confirm-token',
      tokenHash: 'abc',
      type: 'email',
    })
    expect(parseAppAuthParams('?token_hash=abc&type=signup', '').kind).toBe('confirm-token')
  })

  it('reads a recovery token_hash', () => {
    expect(parseAppAuthParams('?token_hash=r1&type=recovery', '')).toEqual({ kind: 'recovery-token', tokenHash: 'r1' })
  })

  it('accepts the session Supabase puts in the fragment after its own verify', () => {
    expect(parseAppAuthParams('', '#access_token=a&refresh_token=r&type=signup')).toEqual({
      kind: 'confirmed-session',
      accessToken: 'a',
      refreshToken: 'r',
    })
    expect(parseAppAuthParams('', '#access_token=a&refresh_token=r&type=recovery').kind).toBe('recovery-session')
  })

  it('reports errors from the fragment', () => {
    expect(
      parseAppAuthParams('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    ).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' })
  })

  it('rejects unknown types and empty links', () => {
    expect(parseAppAuthParams('?token_hash=abc&type=magic', '').kind).toBe('invalid')
    expect(parseAppAuthParams('', '').kind).toBe('invalid')
  })
})

describe('buildAppCallbackUrl', () => {
  it('passes the tokens to the app in the fragment', () => {
    const url = buildAppCallbackUrl({ access_token: 'a b', refresh_token: 'r' })
    expect(url).toBe('dumbospizza://auth/callback#access_token=a+b&refresh_token=r&type=signup')
  })
})

describe('appAuthErrorMessage', () => {
  it('explains expired links', () => {
    expect(appAuthErrorMessage('otp_expired', null)).toMatch(/abgelaufen/)
  })
  it('explains a reused password', () => {
    expect(appAuthErrorMessage('same_password', 'New password should be different from the old password.')).toMatch(
      /unterscheiden/,
    )
  })
})
