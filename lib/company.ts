/**
 * Реквизиты продавца для юридически значимых документов (Beleg/Rechnung, письма).
 * Источник — Impressum (Weisses Haus GmbH). Держим в одном месте, чтобы чек,
 * страница подтверждения и будущие e-mail-квитанции не расходились.
 */
export const SELLER = {
  legalName: 'Weisses Haus GmbH',
  brand: 'Dumbo Slice Pizza', // Handelsname auf Beleg/Rechnung
  marketingName: 'Dumbos Pizza', // Marke auf Website/Newsletter
  managingDirector: 'Mykhailo Barkhan', // Geschäftsführer
  street: 'Kurhausstr. 11-A',
  postalCode: '97688',
  city: 'Bad Kissingen',
  country: 'Deutschland',
  phone: '0151 141/34 094',
  email: 'info@dumbospizza.de',
  registerCourt: 'Amtsgericht Schweinfurt', // Registergericht
  registerNumber: 'HRB 9292', // Handelsregisternummer
  vatId: 'DE365866180', // USt-IdNr. § 27a UStG
  taxNumber: '205/142/20396', // Steuernummer
} as const;
