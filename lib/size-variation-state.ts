export type EmbeddedProductSize = {
  id?: string;
  variationId?: string | null;
  name?: string;
  label?: string;
  price?: number;
  active?: boolean;
  [key: string]: unknown;
};

export type SizeVariationState = {
  _id?: unknown;
  id?: unknown;
  name?: string;
  label?: string;
  active?: boolean;
};

function variationIdOf(variation: SizeVariationState): string {
  return String(variation._id ?? variation.id ?? '');
}

/**
 * Kanonischer Schlüssel eines Größennamens: unabhängig von Groß-/Kleinschreibung,
 * Leerzeichen, „×“ vs. „x“ und der Reihenfolge der Kantenlängen
 * („ca. 40x30“ und „ca. 30x40“ sind derselbe Größenschlüssel).
 * Wer Produkte nach einem Größennamen filtert, sollte hierüber vergleichen —
 * ein roher ===-Vergleich bricht, sobald die Größe umbenannt wird.
 */
export function normalizedSizeName(value: unknown): string {
  const compact = String(value || '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[×*]/g, 'x')
    .replace(/\s+/g, '');
  const dimensions = compact.match(/(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)/);
  if (!dimensions) return compact.replace(/[.,]/g, '');

  const sides = [dimensions[1], dimensions[2]]
    .map((side) => Number(side.replace(',', '.')))
    .sort((a, b) => a - b);
  return `dimensions:${sides[0]}x${sides[1]}`;
}

/**
 * Применяет состояние размера из общей библиотеки к его копии внутри товара.
 * Размер без variationId считается legacy-размером и остаётся доступным.
 */
export function applySizeVariationStates(
  sizes: EmbeddedProductSize[] | null | undefined,
  variations: SizeVariationState[]
): EmbeddedProductSize[] {
  if (!Array.isArray(sizes) || sizes.length === 0) return [];

  const byId = new Map(
    variations
      .map((variation) => [variationIdOf(variation), variation] as const)
      .filter(([id]) => Boolean(id))
  );

  return sizes.map((size) => {
    const variationId = String(size?.variationId ?? '');
    const variation = variationId ? byId.get(variationId) : undefined;
    if (!variation) return size;

    return {
      ...size,
      name: variation.name ?? size.name,
      label: variation.label ?? size.label,
      active: variation.active !== false,
    };
  });
}

/**
 * Убирает размеры, которые были привязаны к библиотеке, но их запись уже
 * удалена. Legacy-размеры без variationId не затрагиваются.
 */
export function removeOrphanedSizeVariations(
  sizes: EmbeddedProductSize[] | null | undefined,
  variations: SizeVariationState[]
): EmbeddedProductSize[] {
  if (!Array.isArray(sizes) || sizes.length === 0) return [];

  const byId = new Map(
    variations
      .map((variation) => [variationIdOf(variation), variation] as const)
      .filter(([id]) => Boolean(id))
  );
  const byName = new Map<string, SizeVariationState>();
  for (const variation of variations) {
    const key = normalizedSizeName(variation.name);
    if (key && !byName.has(key)) byName.set(key, variation);
  }

  return sizes.flatMap((size) => {
    const explicitVariationId = String(size?.variationId ?? '');
    const legacyLibraryId = /^[a-f\d]{24}$/i.test(String(size?.id ?? ''))
      ? String(size.id)
      : '';
    const linkedId = explicitVariationId || legacyLibraryId;
    if (!linkedId) return [size];

    const variation = byId.get(linkedId) || byName.get(normalizedSizeName(size.name));
    if (!variation) return [];

    return [{ ...size, variationId: variationIdOf(variation) }];
  });
}

/** Удаляет конкретный библиотечный размер из массива размеров товара. */
export function removeSizeVariation(
  sizes: EmbeddedProductSize[] | null | undefined,
  variationId: string,
  variationName?: string
): EmbeddedProductSize[] {
  if (!Array.isArray(sizes) || sizes.length === 0) return [];

  const deletedName = normalizedSizeName(variationName);

  return sizes.filter((size) => {
    const linkedId = String(size?.variationId ?? '');
    if (linkedId === variationId) return false;

    if (deletedName && normalizedSizeName(size?.name) === deletedName) return false;

    // Ранние записи могли хранить id библиотеки только в поле id.
    return String(size?.id ?? '') !== variationId;
  });
}
