/**
 * Реквизиты продавца для юридически значимых документов (Beleg/Rechnung, письма).
 * Источник — Impressum (Weisses Haus GmbH). Держим в одном месте, чтобы чек,
 * страница подтверждения и будущие e-mail-квитанции не расходились.
 */
export const SELLER = {
  legalName: 'Weisses Haus GmbH',
  brand: 'Dumbo Pizza',
  street: 'Kurhausstr. 11-A',
  postalCode: '97688',
  city: 'Bad Kissingen',
  country: 'Deutschland',
  phone: '0151 141/34 094',
  email: 'infi@dumbospizza.de',
  vatId: 'DE365866180', // USt-IdNr. § 27a UStG
  taxNumber: '205/142/20396', // Steuernummer
} as const;
