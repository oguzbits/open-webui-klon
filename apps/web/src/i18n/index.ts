import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';

export const LANGUAGE = { GERMAN: 'de', ENGLISH: 'en' } as const;

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: LANGUAGE.GERMAN,
  fallbackLng: LANGUAGE.GERMAN,
  // React escapes output itself.
  interpolation: { escapeValue: false },
});

export default i18n;
