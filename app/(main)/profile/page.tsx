import { redirect } from 'next/navigation';

// Личный кабинет переехал на /account (реальная авторизация email+пароль).
// Старый /profile (фейковая SMS-верификация) оставлен как редирект,
// чтобы не ломать существующие ссылки.
export default function ProfileRedirect() {
  redirect('/account');
}
