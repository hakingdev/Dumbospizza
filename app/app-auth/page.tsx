import type { Metadata } from 'next'
import AppAuthClient from '../../components/app-auth/AppAuthClient'

/**
 * /app-auth — ссылки из писем приложения Dumbo Slice (подтверждение регистрации,
 * сброс пароля). Вся логика в браузере: токен в query/фрагменте, сервер его не видит.
 */
export const metadata: Metadata = {
  title: 'Konto bestätigen | Dumbo Slice',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function AppAuthPage() {
  return <AppAuthClient />
}
