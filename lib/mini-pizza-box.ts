/**
 * 4er Mini Pizza Box — Konstanten & Helfer.
 *
 * Das Box-Produkt (einziges Produkt der Kategorie MINI_BOX_CATEGORY_SLUG) ist eine
 * Konfigurator-Karte: der Kunde wählt GENAU 4 Mini-Pizzen (ca. 18 cm) aus den Sorten
 * der Pizza-Kategorie — auch 4× dieselbe. Preis der Box = Summe der 4 Mini-Preise.
 *
 * Der Mini-Preis je Sorte lebt als eigene Größe (MINI_SIZE_NAME) am Pizza-Produkt
 * (Lieferando-Modell: absolute Preise je Größe, pflegbar im Admin-Produkteditor).
 * Einzeln bestellbar ist die Mini-Größe NICHT: kundenseitige Größenauswahl und
 * »ab«-Preise filtern sie über isMiniSize() aus (siehe lib/product-pricing.ts).
 */

export const MINI_BOX_CATEGORY_SLUG = 'mini-pizza-box';

/** Anzahl Mini-Pizzen pro Box (fix: 2×2-Schachtel). */
export const MINI_BOX_SLOTS = 4;

/** Datenname der Mini-Größe an Pizza-Produkten (Quelle des Mini-Preises je Sorte). */
export const MINI_SIZE_NAME = 'Mini 18cm';

export function isMiniSize(size: { name?: string } | null | undefined): boolean {
  return (size?.name || '').trim().toLowerCase() === MINI_SIZE_NAME.toLowerCase();
}
