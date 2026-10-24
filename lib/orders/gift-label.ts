/**
 * Aktions-/Geschenk-Positionen tragen im gespeicherten Namen ein Label-Präfix
 * wie `[GRATIS] ` oder `[AKTION] ` (siehe app/api/orders/route.ts). Auf Bons und
 * in Telegram soll die Position OHNE dieses Label erscheinen — nur Produkt und
 * Preis, keine „gratis"/„Rabatt"-Kennzeichnung (Wunsch des Inhabers).
 *
 * Das Präfix bleibt IN DER DB erhalten, weil andere Logik (z. B.
 * lib/orders/favorites.ts) es zum Ausschluss von Aktions-Positionen braucht —
 * deshalb wird es nur beim Rendern entfernt, nicht an der Quelle.
 *
 * Entfernt werden ALLE führenden `[...]`-Labels (auch mehrere hintereinander).
 */
const LEADING_LABEL_RE = /^(?:\s*\[[^\]]*\]\s*)+/;

export function stripPromoLabels(name: string): string {
  return String(name ?? '').replace(LEADING_LABEL_RE, '');
}

/**
 * Ist die Position eine Aktions-Belohnung ([GRATIS]/[AKTION]-Label im Namen)?
 * Solche Zeilen dürfen z. B. bei „Bestellung wiederholen" NICHT kopiert werden:
 * die Belohnung vergibt die AKTUELLE Aktion neu (oder eben nicht mehr).
 */
export function isPromoRewardName(name: string): boolean {
  return LEADING_LABEL_RE.test(String(name ?? ''));
}
