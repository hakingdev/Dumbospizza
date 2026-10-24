/**
 * Сумма в евро по-немецки для витрины: 17.4 → «17,40 €». Раньше цены
 * печатались через toFixed(2) («17.40 €»), а часть экранов — уже с запятой,
 * и гость видел оба формата в одном заказе.
 */
const EURO = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEuro(amount: number | null | undefined): string {
  return EURO.format(Number(amount) || 0);
}
