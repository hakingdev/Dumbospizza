/**
 * Приём снимка каталога от агента Lieferando — живая обвязка (БД, очередь
 * команд, Telegram). Чистая логика — в ./catalog, хранение — в ./catalog-store.
 *
 * Зовёт только роут app/api/lieferando/agent/catalog. Отдельный модуль, потому
 * что здесь нужен sendControlMessage из telegram-control, а тот через
 * menu-stop/service читает снимок (catalog-store) — цикла импортов нет только
 * при таком разрезе.
 */
import { reportLieferandoResult, CATALOG_TARGET } from '../lieferando-makilove';
import { sendControlMessage } from '../telegram-control';
import {
  buildCatalogRecord,
  catalogChanges,
  formatCatalogFailure,
  formatCatalogSummary,
  hasCatalogChanges,
  mergeFailedCategories,
  reconcileCatalog,
  type CatalogChanges,
  type LieferandoCatalog,
} from './catalog';
import { getLieferandoCatalogRecord, loadSiteItems, saveLieferandoCatalogRecord } from './catalog-store';

export interface CatalogUpload {
  /** id команды из очереди (агент снимал по кнопке) — закрываем её отчётом; нет = ежедневный/CLI */
  id?: string | null;
  /** 'command' | 'daily' | 'cli' — только для текста сообщения о сбое */
  reason?: string;
  agentId?: string;
  ok: boolean;
  error?: string;
  catalog: LieferandoCatalog | null;
}

export interface CatalogReceipt {
  stored: boolean;
  notified: boolean;
  changes: CatalogChanges | null;
}

/**
 * Снимок пришёл: подставить строки не открывшихся категорий из прошлого
 * снимка, сверить с сайтом, сохранить, закрыть команду в очереди (если была)
 * и прислать в группу ТОЛЬКО изменения. Сбой снятия — сообщение о сбое.
 */
export async function receiveCatalogSnapshot(
  upload: CatalogUpload,
  now: Date = new Date()
): Promise<CatalogReceipt> {
  const closeCommand = async (ok: boolean, count: number, failed: number, message: string) => {
    if (!upload.id) return;
    await reportLieferandoResult(
      { id: upload.id, action: 'on', target: CATALOG_TARGET, ok, count, failed, message },
      now
    );
  };

  if (!upload.ok || !upload.catalog) {
    const error = (upload.error || 'снимок пуст').slice(0, 300);
    await closeCommand(false, 0, 1, error);
    const notified = await sendControlMessage(formatCatalogFailure(error, upload.reason));
    return { stored: false, notified, changes: null };
  }

  const prev = await getLieferandoCatalogRecord();
  const catalog = mergeFailedCategories(upload.catalog, prev);
  const siteItems = await loadSiteItems();
  const report = reconcileCatalog(catalog, siteItems);
  const changes = catalogChanges(prev, catalog, report);

  await saveLieferandoCatalogRecord(buildCatalogRecord(catalog, report, now.toISOString()));
  const count = catalog.categories.reduce((n, c) => n + c.items.length, 0);
  await closeCommand(
    true,
    count,
    catalog.failedCategories.length,
    catalog.failedCategories.length ? `не открылись категории: ${catalog.failedCategories.join(', ')}` : ''
  );

  let notified = false;
  if (hasCatalogChanges(changes)) {
    notified = await sendControlMessage(formatCatalogSummary(changes, catalog));
  }
  console.log('[lieferando-catalog] snapshot received', {
    reason: upload.reason,
    agentId: upload.agentId,
    categories: catalog.categories.length,
    items: count,
    matched: report.matched,
    hubOnly: report.hubOnly.length,
    mismatches: report.mismatches.length,
    notified,
  });
  return { stored: true, notified, changes };
}
