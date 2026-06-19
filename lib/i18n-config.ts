export const defaultNS = 'common';
export const cookieName = 'i18next';

export const fallbackLng = 'de';
export const languages = [fallbackLng];

export function getOptions(lng = fallbackLng, ns: string | string[] = defaultNS) {
  return {
    // debug: process.env.NODE_ENV === 'development',
    supportedLngs: languages,
    fallbackLng,
    lng,
    fallbackNS: defaultNS,
    defaultNS,
    ns,
  };
}
