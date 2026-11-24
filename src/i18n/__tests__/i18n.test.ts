import AsyncStorage from '@react-native-async-storage/async-storage';
import { en, TranslationKey } from '../en';
import { bg } from '../bg';
import { es } from '../es';
import {
  CACHE_KEY_LANGUAGE,
  t,
  localizeCategoryName,
  detectSystemLocale,
  normalizeLocaleTag,
  setActiveLanguagePreference,
  getActiveLanguagePreference,
  getResolvedLocale,
  getFormattingLocale,
  loadStoredLanguagePreference,
  persistLanguagePreference,
  __setMockSystemLocaleForTesting,
} from '../index';
import { formatDateDisplay } from '../../utils/dates';
import { formatRepeatDescription } from '../../utils/repeat';
import { formatReminderDescription } from '../../utils/reminders';
import { parseAndValidateServerUrl } from '../../api/client';
import { RepeatMode, ReminderRelativeTo } from '../../types/vikunja';

function extractPlaceholders(str: string): string[] {
  const matches = Array.from(str.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1]);
  return Array.from(new Set(matches)).sort();
}

describe('i18n Engine & Dictionary Parity (EN, BG, ES)', () => {
  afterEach(async () => {
    __setMockSystemLocaleForTesting(null);
    setActiveLanguagePreference('system');
    await AsyncStorage.clear();
  });

  it('guarantees 100% key parity, non-empty strings, and exact {placeholder} parity across EN, BG, and ES', () => {
    const enKeys = Object.keys(en).sort() as TranslationKey[];
    const bgKeys = Object.keys(bg).sort();
    const esKeys = Object.keys(es).sort();

    expect(bgKeys).toEqual(enKeys);
    expect(esKeys).toEqual(enKeys);

    for (const key of enKeys) {
      const enVal = en[key];
      const bgVal = bg[key];
      const esVal = es[key];

      expect(typeof enVal).toBe('string');
      expect(enVal.trim().length).toBeGreaterThan(0);

      expect(typeof bgVal).toBe('string');
      expect(bgVal.trim().length).toBeGreaterThan(0);

      expect(typeof esVal).toBe('string');
      expect(esVal.trim().length).toBeGreaterThan(0);

      const enTokens = extractPlaceholders(enVal);
      expect(extractPlaceholders(bgVal)).toEqual(enTokens);
      expect(extractPlaceholders(esVal)).toEqual(enTokens);
    }
  });

  it('normalizes BCP-47 locale tags and falls back to English for unsupported locales', () => {
    expect(normalizeLocaleTag('bg')).toBe('bg');
    expect(normalizeLocaleTag('bg-BG')).toBe('bg');
    expect(normalizeLocaleTag('bg_BG')).toBe('bg');
    expect(normalizeLocaleTag('es')).toBe('es');
    expect(normalizeLocaleTag('es-ES')).toBe('es');
    expect(normalizeLocaleTag('es-MX')).toBe('es');
    expect(normalizeLocaleTag('en-US')).toBe('en');
    expect(normalizeLocaleTag('fr-FR')).toBeNull();
    expect(normalizeLocaleTag('')).toBeNull();
    expect(normalizeLocaleTag(null)).toBeNull();

    __setMockSystemLocaleForTesting('bg-BG');
    expect(detectSystemLocale()).toBe('bg');
    expect(getResolvedLocale('system')).toBe('bg');

    __setMockSystemLocaleForTesting('es-AR');
    expect(detectSystemLocale()).toBe('es');
    expect(getResolvedLocale('system')).toBe('es');

    __setMockSystemLocaleForTesting('de-DE');
    expect(detectSystemLocale()).toBe('en');
    expect(getResolvedLocale('system')).toBe('en');
  });

  it('persists and loads language preference via AsyncStorage while interpolating parameters', async () => {
    await persistLanguagePreference('bg');
    expect(getActiveLanguagePreference()).toBe('bg');
    expect(await AsyncStorage.getItem(CACHE_KEY_LANGUAGE)).toBe('bg');
    expect(getFormattingLocale()).toBe('bg-BG');
    expect(t('tasks.openCount', { count: 4 })).toBe('4 активни');

    setActiveLanguagePreference('en');
    const loaded = await loadStoredLanguagePreference();
    expect(loaded).toBe('bg');
    expect(getActiveLanguagePreference()).toBe('bg');

    await persistLanguagePreference('es');
    expect(getFormattingLocale()).toBe('es-ES');
    expect(t('tasks.openCount', { count: 4 })).toBe('4 pendientes');
  });

  it('localizes canonical Smart Grouping & Supermarket Aisle categories while preserving custom user categories', () => {
    expect(localizeCategoryName('🥦 Produce', 'en')).toBe('🥦 Produce');
    expect(localizeCategoryName('🥦 Produce', 'bg')).toBe('🥦 Плодове и зеленчуци');
    expect(localizeCategoryName('🥦 Produce', 'es')).toBe('🥦 Frutas y verduras');

    expect(localizeCategoryName('🥛 Dairy & Cold', 'bg')).toBe('🥛 Млечни и охладени');
    expect(localizeCategoryName('🥛 Dairy & Cold', 'es')).toBe('🥛 Lácteos y refrigerados');

    expect(localizeCategoryName('General', 'bg')).toBe('Общи');
    expect(localizeCategoryName('General', 'es')).toBe('General');

    // Preserves custom bracket/colon categories verbatim
    expect(localizeCategoryName('Deli Counter', 'bg')).toBe('Deli Counter');
    expect(localizeCategoryName('Crucial', 'es')).toBe('Crucial');
  });

  it('localizes dates, recurrence descriptions, reminders, and URL validation errors in Bulgarian and Spanish', () => {
    const refNow = new Date(2026, 8, 20, 10, 0, 0, 0);
    const todayIso = new Date(2026, 8, 20, 15, 0, 0, 0).toISOString();
    const tomorrowIso = new Date(2026, 8, 21, 9, 0, 0, 0).toISOString();
    const yesterdayIso = new Date(2026, 8, 19, 18, 0, 0, 0).toISOString();

    setActiveLanguagePreference('bg');
    expect(formatDateDisplay(todayIso, { now: refNow, includeTime: false })).toBe('Днес');
    expect(formatDateDisplay(tomorrowIso, { now: refNow, includeTime: false })).toBe('Утре');
    expect(formatDateDisplay(yesterdayIso, { now: refNow, includeTime: false })).toBe('Вчера');
    expect(formatDateDisplay(todayIso, { now: refNow, includeTime: true })).toContain('Днес, ');
    expect(formatRepeatDescription(86400, RepeatMode.FromDueDate)).toBe('Ежедневно');
    expect(formatRepeatDescription(3 * 86400, RepeatMode.FromDueDate)).toBe('На всеки 3 дни');
    expect(formatRepeatDescription(2 * 604800, RepeatMode.FromCompletion)).toBe(
      'На всеки 2 седмици (след завършване)'
    );
    expect(
      formatReminderDescription({
        relative_period: -900,
        relative_to: ReminderRelativeTo.DueDate,
      })
    ).toBe('15 минути преди срока');
    expect(() => parseAndValidateServerUrl('')).toThrow('Адресът на сървъра е задължителен');

    setActiveLanguagePreference('es');
    expect(formatDateDisplay(todayIso, { now: refNow, includeTime: false })).toBe('Hoy');
    expect(formatDateDisplay(tomorrowIso, { now: refNow, includeTime: false })).toBe('Mañana');
    expect(formatDateDisplay(yesterdayIso, { now: refNow, includeTime: false })).toBe('Ayer');
    expect(formatDateDisplay(todayIso, { now: refNow, includeTime: true })).toContain('Hoy, ');
    expect(formatRepeatDescription(86400, RepeatMode.FromDueDate)).toBe('Diariamente');
    expect(formatRepeatDescription(3 * 86400, RepeatMode.FromDueDate)).toBe('Cada 3 días');
    expect(formatRepeatDescription(2 * 604800, RepeatMode.FromCompletion)).toBe(
      'Cada 2 semanas (desde completado)'
    );
    expect(
      formatReminderDescription({
        relative_period: -900,
        relative_to: ReminderRelativeTo.DueDate,
      })
    ).toBe('15 minutos antes del vencimiento');
    expect(() => parseAndValidateServerUrl('')).toThrow('La URL del servidor es obligatoria');
  });
});
