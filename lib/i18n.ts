import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { getOptions, languages, fallbackLng } from './i18n-config';

const resourceLoaders: Record<string, (ns: string) => Promise<any>> = {
  ru: (ns: string) => import(`../public/locales/ru/${ns}.json`),
  de: (ns: string) => import(`../public/locales/de/${ns}.json`),
};

// На стороне клиента мы не хотим использовать кеш, который устанавливается на сервере
// Таким образом каждый раз создаем новый экземпляр

const normalizeLanguage = (lng: string) => (languages.includes(lng) ? lng : fallbackLng);

const initI18next = async (lng: string, ns: string | string[]) => {
  const normalizedLng = normalizeLanguage(lng);
  const i18nInstance = createInstance();
  await i18nInstance
    .use(initReactI18next)
    .use(
      resourcesToBackend((language: string, namespace: string) => {
        const normalized = normalizeLanguage(language);
        const loader = resourceLoaders[normalized] || resourceLoaders[fallbackLng];
        return loader(namespace);
      })
    )
    .init(getOptions(normalizedLng, ns));

  return i18nInstance;
};

export async function loadTranslation(
  lng: string,
  ns: string | string[] = 'common',
  options: { keyPrefix?: string } = {}
) {
  const i18nextInstance = await initI18next(lng, ns);
  return {
    t: i18nextInstance.getFixedT(
      normalizeLanguage(lng),
      Array.isArray(ns) ? ns[0] : ns,
      options.keyPrefix
    ),
    i18n: i18nextInstance,
  };
}
