/**
 * Einmaliger Datenfix: Aktion «2+1 = 3» (BOGO) qualifiziert die große Pizza 30×40
 * nicht, weil ihre targetItems den veralteten Größennamen «ca. 40x30» führen,
 * während die Produkte real «ca. 30x40» heißen (Größe wurde umbenannt, Aktion nicht
 * nachgezogen). Zusätzlich existiert der Phantomname «ca. 40x40» an keinem Produkt.
 *
 * Fix (nur targetItems — rewardItems bleibt unberührt, die Belohnung pflegt der
 * Betreiber selbst im Angebot-Menü):
 *   - sizeName «ca. 40x30» → «ca. 30x40»   (echter Name der 30×40-Größe)
 *   - sizeName «ca. 40x40» → entfernen      (existiert an keinem Produkt)
 *   - «ca. 20x20» / «ca. 60x40» bleiben     (echte Größennamen)
 *   - Dedupe nach (productId, sizeName)
 *
 * Lokal & Prod nutzen DIESELBE Supabase-DB. Ausführen:
 *   node scripts/fix-2plus1-target-sizes.mjs            # Dry-Run (nur Vorschau)
 *   node scripts/fix-2plus1-target-sizes.mjs --apply    # schreibt in die DB
 *
 * Idempotent: erneuter Lauf ändert nichts mehr. Backup der alten targetItems wird
 * vor dem Schreiben nach scripts/.backup-2plus1-targetItems-<promoId>.json gelegt.
 */
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'fs';

const PROMO_ID = '6a391b8860a0c6f475c47fbd'; // «2+1 = 3» (type: bogo)
const RENAME = { 'ca. 40x30': 'ca. 30x40' };
const DROP = new Set(['ca. 40x40']);

const apply = process.argv.includes('--apply');

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!url) throw new Error('DATABASE_URL nicht gefunden (weder env noch .env.local)');
  return url;
}

function transform(items) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const productId = String(it.productId);
    let sizeName = typeof it.sizeName === 'string' ? it.sizeName : '';
    if (DROP.has(sizeName)) continue;
    if (sizeName in RENAME) sizeName = RENAME[sizeName];
    const key = `${productId}|${sizeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ productId, sizeName });
  }
  return out;
}

const sql = postgres(databaseUrl(), { prepare: false });

async function main() {
  const rows = await sql`
    SELECT id, name, target_items, reward_items
    FROM promotions WHERE id = ${PROMO_ID}
  `;
  if (rows.length === 0) throw new Error(`Aktion ${PROMO_ID} nicht gefunden`);
  const promo = rows[0];
  const before = promo.target_items || [];
  const after = transform(before);

  const summarize = (arr) => {
    const bySize = {};
    for (const it of arr) bySize[it.sizeName] = (bySize[it.sizeName] || 0) + 1;
    return bySize;
  };

  console.log(`Aktion: «${promo.name}» (${PROMO_ID})`);
  console.log(`targetItems VORHER : ${before.length} Einträge`, summarize(before));
  console.log(`targetItems NACHHER: ${after.length} Einträge`, summarize(after));
  console.log(`rewardItems (unberührt): ${(promo.reward_items || []).length} Einträge`, summarize(promo.reward_items || []));

  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (!changed) {
    console.log('\n✓ Bereits korrekt — nichts zu tun (idempotent).');
    return;
  }

  if (!apply) {
    console.log('\nDRY-RUN — nichts geschrieben. Zum Anwenden: node scripts/fix-2plus1-target-sizes.mjs --apply');
    return;
  }

  const backupPath = new URL(`./.backup-2plus1-targetItems-${PROMO_ID}.json`, import.meta.url);
  writeFileSync(backupPath, JSON.stringify(before, null, 2));
  console.log(`\nBackup der alten targetItems: ${backupPath.pathname}`);

  await sql`
    UPDATE promotions
    SET target_items = ${sql.json(after)}, updated_at = now()
    WHERE id = ${PROMO_ID}
  `;
  console.log('✓ targetItems aktualisiert.');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error('FEHLER:', e.message);
    await sql.end();
    process.exit(1);
  });
