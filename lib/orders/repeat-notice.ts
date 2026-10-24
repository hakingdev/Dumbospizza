/**
 * Flash-Notiz für „Bestellung wiederholen": Positionen, die es nicht mehr im
 * Sortiment gibt, werden beim Wiederholen übersprungen — die Namen wandern über
 * sessionStorage auf die /cart-Seite und werden dort EINMAL als Banner gezeigt.
 */
export const REPEAT_SKIPPED_STORAGE_KEY = 'repeatOrderSkippedItems';
