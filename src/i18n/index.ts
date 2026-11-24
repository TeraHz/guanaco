import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { en, TranslationKey } from './en';
import { bg } from './bg';
import { es } from './es';

export type { TranslationKey };
export type SupportedLocale = 'en' | 'bg' | 'es';
export type LanguagePreference = 'system' | SupportedLocale;

export const CACHE_KEY_LANGUAGE = '@vikunja_language';

const DICTIONARIES: Record<SupportedLocale, Record<TranslationKey, string>> = {
  en,
  bg,
  es,
};

const CANONICAL_CATEGORY_TO_KEY: Record<string, TranslationKey> = {
  General: 'category.general',
  '🥦 Produce': 'category.produce',
  '🥛 Dairy & Cold': 'category.dairy',
  '🥩 Meat & Seafood': 'category.meat',
  '🍞 Bakery & Pantry': 'category.bakery',
  '🧼 Household': 'category.household',
  '🛒 Groceries': 'category.groceries',
  '📄 Travel & Documents': 'category.travelDocs',
  '🧳 Clothes & Wearables': 'category.clothes',
  '🔌 Electronics': 'category.electronics',
  '💊 Toiletries & Health': 'category.toiletries',
  '🎒 Gear & Essentials': 'category.gear',
  '🔨 Tools & Hardware': 'category.tools',
  '🎨 Paint & Finishes': 'category.paint',
  '💡 Electrical & Lighting': 'category.electrical',
  '🚰 Plumbing & Fixtures': 'category.plumbing',
  '🪵 Materials & Supplies': 'category.materials',
  '💻 Engineering': 'category.engineering',
  '🧪 QA & Testing': 'category.qa',
  '🎨 Design & UX': 'category.design',
  '🚀 DevOps & Release': 'category.devops',
  '📋 Planning & Tasks': 'category.planning',
  '🍕 Food & Refreshments': 'category.food',
  '✉️ Invitations & Guests': 'category.invitations',
  '🎉 Decor & Venue': 'category.decor',
  '🎵 Activities & Coordination': 'category.activities',
};

let activeLanguagePref: LanguagePreference = 'system';
let mockSystemLocaleForTesting: string | null = null;
const languageListeners = new Set<() => void>();

export function isValidLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'en' || value === 'bg' || value === 'es';
}

export function normalizeLocaleTag(tag?: string | null): SupportedLocale | null {
  if (!tag || typeof tag !== 'string') return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'bg') return 'bg';
  if (primary === 'es') return 'es';
  if (primary === 'en') return 'en';
  return null;
}

export function __setMockSystemLocaleForTesting(locale: string | null): void {
  mockSystemLocaleForTesting = locale;
  languageListeners.forEach((listener) => listener());
}

export function detectSystemLocale(): SupportedLocale {
  if (mockSystemLocaleForTesting !== null) {
    return normalizeLocaleTag(mockSystemLocaleForTesting) || 'en';
  }

  // Keep Jest unit tests deterministic across developer machines regardless of host OS language
  if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
    return 'en';
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      const navMatch = normalizeLocaleTag(navigator.language);
      if (navMatch) return navMatch;
    }
  } catch (_) {}

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      const resolved = Intl.DateTimeFormat().resolvedOptions()?.locale;
      const intlMatch = normalizeLocaleTag(resolved);
      if (intlMatch) return intlMatch;
    }
  } catch (_) {}

  return 'en';
}

export function setActiveLanguagePreference(pref: LanguagePreference): void {
  const safePref: LanguagePreference = isValidLanguagePreference(pref) ? pref : 'system';
  if (activeLanguagePref !== safePref) {
    activeLanguagePref = safePref;
    languageListeners.forEach((listener) => listener());
  }
}

export function getActiveLanguagePreference(): LanguagePreference {
  return activeLanguagePref;
}

export function getResolvedLocale(pref: LanguagePreference = activeLanguagePref): SupportedLocale {
  if (pref === 'en' || pref === 'bg' || pref === 'es') {
    return pref;
  }
  return detectSystemLocale();
}

/**
 * Returns the BCP-47 locale tag for `Date.prototype.toLocaleDateString` / `toLocaleTimeString`.
 * When preference is `'system'` and resolved locale is `'en'`, returns `undefined` so native OS
 * 12h/24h regional preferences continue to apply seamlessly.
 */
export function getFormattingLocale(locale?: SupportedLocale): string | undefined {
  const target = locale ?? getResolvedLocale();
  if (target === 'bg') return 'bg-BG';
  if (target === 'es') return 'es-ES';
  return activeLanguagePref === 'en' ? 'en-US' : undefined;
}

export async function loadStoredLanguagePreference(): Promise<LanguagePreference> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_LANGUAGE);
    if (isValidLanguagePreference(raw)) {
      setActiveLanguagePreference(raw);
      return raw;
    }
  } catch (_) {}
  return activeLanguagePref;
}

export async function persistLanguagePreference(pref: LanguagePreference): Promise<void> {
  const safePref: LanguagePreference = isValidLanguagePreference(pref) ? pref : 'system';
  setActiveLanguagePreference(safePref);
  try {
    await AsyncStorage.setItem(CACHE_KEY_LANGUAGE, safePref);
  } catch (_) {}
}

function subscribeLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

function getSnapshotString(): string {
  return `${activeLanguagePref}:${getResolvedLocale(activeLanguagePref)}`;
}

/**
 * Translates `key` into the active (or specified) locale, interpolating `{param}` placeholders.
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  localeOverride?: SupportedLocale
): string {
  const resolved = localeOverride ?? getResolvedLocale();
  const dict = DICTIONARIES[resolved] || DICTIONARIES.en;
  const template = Object.prototype.hasOwnProperty.call(dict, key)
    ? dict[key]
    : DICTIONARIES.en[key] ?? key;

  if (!params) return template;

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(params, token)) {
      return String(params[token]);
    }
    return match;
  });
}

/**
 * Translates canonical Smart Grouping / Supermarket Aisle category identifiers into the active
 * UI language while preserving custom user bracket/colon categories (e.g. `[Deli]`) verbatim.
 */
export function localizeCategoryName(category: string, localeOverride?: SupportedLocale): string {
  if (!category || typeof category !== 'string') {
    return t('category.general', undefined, localeOverride);
  }
  if (Object.prototype.hasOwnProperty.call(CANONICAL_CATEGORY_TO_KEY, category)) {
    return t(CANONICAL_CATEGORY_TO_KEY[category], undefined, localeOverride);
  }
  return category;
}

export function useTranslation() {
  useSyncExternalStore(subscribeLanguage, getSnapshotString, getSnapshotString);
  const languagePreference = activeLanguagePref;
  const locale = getResolvedLocale(languagePreference);

  const translate = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => t(key, params, locale),
    [locale]
  );

  return {
    t: translate,
    locale,
    languagePreference,
    setLanguagePreference: persistLanguagePreference,
  };
}
