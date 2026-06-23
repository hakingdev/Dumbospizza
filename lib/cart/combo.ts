/**
 * Matchday-Kombi im Warenkorb.
 *
 * Eine Kombi ist KEINE Sammelposition mehr, sondern MEHRERE eigenständige
 * Warenkorb-Positionen, die über `comboId` zusammengehören:
 *   - 2 Pizzen (30×40) mit echtem Preis
 *   - die Gratis-Getränke (Preis 0)
 *   - eine Rabatt-Position (Preis −5 €)
 * Die Summe dieser Positionen ergibt den Kombi-Preis. Dadurch erscheint jede
 * Komponente überall (Warenkorb, Checkout, Bestellung, Telegram, Druck) als
 * eigene Zeile mit eigenem Preis.
 */

export type ComboRole = 'pizza' | 'drink' | 'discount';

export interface ComboItemLike {
  id: string;
  name: string;
  price: number;
  quantity: number;
  comboId?: string;
  comboLabel?: string;
  comboRole?: ComboRole;
  size?: { name?: string; label?: string; size?: string };
}

/** Gehört die Position zu einer Kombi? */
export function isComboItem(item: { comboId?: string }): boolean {
  return Boolean(item.comboId);
}

/** Ist die Position die Rabattzeile der Kombi (Preis −5 €)? */
export function isComboDiscountLine(item: { comboRole?: ComboRole }): boolean {
  return item.comboRole === 'discount';
}

export interface ComboGroup<T extends ComboItemLike> {
  kind: 'combo';
  comboId: string;
  label: string;
  /** Alle Positionen der Kombi in Reihenfolge (inkl. Rabattzeile). */
  items: T[];
  /** Nur die kostenpflichtigen Bestandteile (Pizzen) ohne Gratis/Rabatt. */
  regularTotal: number;
  /** Rabatthöhe als positive Zahl. */
  discount: number;
  /** Endpreis der Kombi (Summe aller Positionen). */
  total: number;
}

export type CartRow<T extends ComboItemLike> =
  | { kind: 'single'; item: T }
  | ComboGroup<T>;

/**
 * Gruppiert eine flache Positionsliste in Einzelartikel + Kombi-Gruppen.
 * Reihenfolge bleibt erhalten (Gruppe erscheint an der Stelle ihrer ersten Position).
 */
export function groupCartRows<T extends ComboItemLike>(items: T[]): CartRow<T>[] {
  const rows: CartRow<T>[] = [];
  const groupIndex = new Map<string, number>();

  for (const item of items) {
    if (!item.comboId) {
      rows.push({ kind: 'single', item });
      continue;
    }
    const existing = groupIndex.get(item.comboId);
    if (existing === undefined) {
      const group: ComboGroup<T> = {
        kind: 'combo',
        comboId: item.comboId,
        label: item.comboLabel || 'Kombi',
        items: [item],
        regularTotal: 0,
        discount: 0,
        total: 0,
      };
      groupIndex.set(item.comboId, rows.length);
      rows.push(group);
    } else {
      (rows[existing] as ComboGroup<T>).items.push(item);
    }
  }

  // Summen je Gruppe berechnen.
  for (const row of rows) {
    if (row.kind !== 'combo') continue;
    for (const it of row.items) {
      const line = it.price * it.quantity;
      row.total += line;
      if (it.comboRole === 'discount') row.discount += -line;
      else row.regularTotal += line;
    }
  }

  return rows;
}
