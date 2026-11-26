import type { NextRequest } from 'next/server';
import { handleAccountDelete } from '../../../../../../lib/account/account-delete-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Ленивый импорт: Drizzle и service_role клиент не грузятся при сборке роута.
  const { accountDeletionDeps } = await import('../../../../../../lib/account/app-account-deletion-deps');
  return handleAccountDelete(request, accountDeletionDeps);
}
