'use client';

import { ReactNode, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import AdminV2Shell from '../../components/admin-v2/shell';

/**
 * Новый портал ресторана (/admin-v2). Авторизация — та же, что у старой
 * админки: next-auth сессия с ролью admin/staff, вход через /admin/login.
 */
export default function AdminV2Layout({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/admin/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <div className="flex items-center gap-3 text-gray-500">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-[#8A6C4C]" />
          Проверка авторизации…
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  const userRole = (session?.user as any)?.role;
  if (!userRole || (userRole !== 'admin' && userRole !== 'staff')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="m-0 text-2xl font-extrabold text-gray-900">Доступ запрещён</h1>
          <p className="m-0 text-gray-600">У вас нет прав для доступа к порталу ресторана</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="h-12 cursor-pointer rounded-xl border-none bg-[#8A6C4C] px-6 text-lg font-bold text-white transition hover:bg-[#7C6145]"
          >
            На главную
          </button>
        </div>
      </div>
    );
  }

  return <AdminV2Shell>{children}</AdminV2Shell>;
}
