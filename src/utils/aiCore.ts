import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '../types/vikunja';
import { classifyTaskContextually } from './smartClassifier';

const AI_CACHE_PREFIX = '@vikunja_aicore_cat_';

let mockAICoreSupported: boolean | null = null;

/**
 * Testing helper to simulate devices with/without AICore.
 */
export function __setMockAICoreSupportedForTesting(supported: boolean | null) {
  mockAICoreSupported = supported;
}

/**
 * Checks if the current device supports On-Device AICore / Gemini Nano.
 * - Checks for window/globalThis.ai.languageModel (Chrome / Android AICore Prompt API).
 * - Checks for Google Pixel 8, 9, 10, 11 Pro, etc. running on Android (Tensor hardware).
 * Returns false on devices without hardware or API support so the option is never shown.
 */
export function isAICoreSupported(): boolean {
  if (mockAICoreSupported !== null) {
    return mockAICoreSupported;
  }

  // 1. Direct Prompt API / Chrome Built-in AI availability
  if (
    typeof (globalThis as any).ai?.languageModel !== 'undefined' ||
    (typeof window !== 'undefined' && typeof (window as any).ai?.languageModel !== 'undefined')
  ) {
    return true;
  }

  // 2. Android hardware check for Pixel devices with Tensor NPU (Pixel 8+, 9, 10, 11, etc.)
  if (Platform.OS === 'android') {
    const constants = (Platform.constants as any) || {};
    const brand = (constants.Brand || (Platform as any).Brand || '').toLowerCase();
    const manufacturer = (constants.Manufacturer || (Platform as any).Manufacturer || '').toLowerCase();
    const model = (constants.Model || (Platform as any).Model || '').toLowerCase();
    const isGoogle = brand.includes('google') || manufacturer.includes('google');

    // Pixel 8, 9, 10, 11 Pro etc.
    const isSupportedPixel = isGoogle && /pixel\s*(?:[89]|1[0-9])/i.test(model);
    if (isSupportedPixel) {
      return true;
    }
  }

  return false;
}

// In-memory fast cache to make synchronous UI sorting instantaneous
const memoryCategoryCache = new Map<string, string>();

function getCacheKey(projectId: number | undefined, taskId: number, contextTitle?: string): string {
  return `${projectId ?? 0}_${taskId}_${(contextTitle || '').trim().toLowerCase()}`;
}

/**
 * Extracts the core subject/ingredient from descriptive phrases.
 * Handles quantities (e.g. "2 кг", "500g", "2 lbs"),
 * prepositional intent clauses (e.g. "X за Y" in Bulgarian, "X for Y" in English),
 * and preparation modifiers (e.g. "peeled", "белен", "замразени", "пресни").
 */
export function extractCoreSubject(title: string): string {
  let cleaned = (title || '').trim();
  if (!cleaned) return '';

  // 1. Remove bracketed / colon prefix tags: "[Bakery] Croissant" -> "Croissant"
  cleaned = cleaned.replace(/^\[.*?\]\s*/, '').replace(/^[A-Za-zА-Яа-я0-9\s]{2,15}:\s+/, '');

  // 2. Remove leading quantities & units (English & Bulgarian)
  // e.g. "2 kg", "2кг", "500g", "500г", "2 бр.", "3 пакета", "1 bottle of", "2 кутии"
  cleaned = cleaned.replace(
    /^(\d+([.,]\d+)?\s*(кг|г|гр|мл|л|бр|пакет|пакета|кутия|кутии|kg|g|ml|l|lbs?|oz|pcs?|cans?|bottles?|packs?|boxes?)(?:\.|\s+|$)\s*(на\s+|of\s+)?)/i,
    ''
  );
  // Also strip bare leading number e.g. "2 "
  cleaned = cleaned.replace(/^\d+\s+/, '');

  // 3. Handle prepositional intent clauses: "X for Y", "X за Y", "X c Y", "X със Y", "X with Y"
  // e.g. "Milk for yogurt" -> "Milk"
  // e.g. "Мляко за кисело мляко" -> "Мляко"
  // e.g. "Pork for stew" -> "Pork"
  // e.g. "Свинско за яхния" -> "Свинско"
  // e.g. "Домати за салата" -> "Домати"
  const prepMatch = cleaned.match(/^(.*?)\s+(for|за|para|pour|с|със|with|con|avec)\s+/i);
  if (prepMatch && prepMatch[1] && prepMatch[1].trim().length > 1) {
    cleaned = prepMatch[1].trim();
  }

  // 4. Strip common descriptive / preparation adjectives at the start
  // e.g. "peeled garlic" -> "garlic", "белен чесън" -> "чесън"
  // e.g. "frozen croissants" -> "croissants", "замразени кроасани" -> "кроасани"
  const adjRegex =
    /^(peeled|fresh|frozen|roasted|baked|raw|organic|whole|skim|sliced|chopped|diced|minced|ground|homemade|белен|белени|белено|пресен|пресни|прясно|замразен|замразени|замразено|печен|печени|печено|суров|сурови|сурово|био|пълномаслен|пълномаслено|обезмаслен|обезмаслено|нарязан|нарязани|млян|мляно|мляна|домашен|домашно|домашни)\s+/i;

  cleaned = cleaned.replace(adjRegex, '').trim();

  return cleaned.length > 0 ? cleaned : title.trim();
}

/**
 * Contextual zero-shot semantic grouping for arbitrary task lists without hardcoding ingredients.
 * Determines the category based on context heuristics (Travel, DIY/Home, Tech/Dev, Events, Shopping, General).
 * Supports English and Bulgarian with descriptive intent phrases.
 */
export function inferContextualCategory(title: string, contextTitle?: string): string {
  const core = extractCoreSubject(title);
  const t = title.toLowerCase();
  const c = core.toLowerCase();
  const ctx = (contextTitle || '').toLowerCase();

  const matches = (...stems: string[]) => stems.some((s) => c.includes(s) || t.includes(s));

  // 1. Travel / Packing
  if (
    ctx.includes('trip') ||
    ctx.includes('pack') ||
    ctx.includes('travel') ||
    ctx.includes('vacation') ||
    ctx.includes('flight') ||
    ctx.includes('camp') ||
    ctx.includes('път') ||
    ctx.includes('почивк') ||
    ctx.includes('куфар')
  ) {
    if (matches('passport', 'ticket', 'visa', 'doc', 'insurance', 'hotel', 'reservation', 'паспорт', 'билет', 'виза', 'документ', 'резерваци')) {
      return '📄 Travel & Documents';
    }
    if (matches('shirt', 'pant', 'sock', 'shoe', 'boot', 'jacket', 'hat', 'coat', 'wear', 'clothes', 'dress', 'дрех', 'тениск', 'риза', 'панталон', 'чорап', 'обувк', 'яке', 'палто', 'бански', 'шапк')) {
      return '🧳 Clothes & Wearables';
    }
    if (matches('charger', 'cable', 'phone', 'laptop', 'adapter', 'battery', 'headphone', 'зарядн', 'кабел', 'телефон', 'лаптоп', 'адаптер', 'батери', 'слушалк')) {
      return '🔌 Electronics';
    }
    if (matches('brush', 'soap', 'shampoo', 'med', 'pill', 'paste', 'sunscreen', 'towel', 'четк', 'сапун', 'шампоан', 'паста за зъби', 'лекарств', 'хапчет', 'кърп', 'дезодорант')) {
      return '💊 Toiletries & Health';
    }
    return '🎒 Gear & Essentials';
  }

  // 2. DIY / Home Renovation / Hardware
  if (
    ctx.includes('remodel') ||
    ctx.includes('diy') ||
    ctx.includes('renov') ||
    ctx.includes('build') ||
    ctx.includes('home') ||
    ctx.includes('fix') ||
    ctx.includes('garden') ||
    ctx.includes('ремонт') ||
    ctx.includes('майстор') ||
    ctx.includes('дом') ||
    ctx.includes('градин')
  ) {
    if (matches('hammer', 'drill', 'screw', 'nail', 'saw', 'tape', 'wrench', 'чук', 'бормашин', 'винтове', 'винт', 'пирон', 'трион', 'клещи')) {
      return '🔨 Tools & Hardware';
    }
    if (matches('paint', 'primer', 'brush', 'roller', 'sandpaper', 'finish', 'боя', 'грунд', 'лак', 'четк', 'валяк', 'шкурк')) {
      return '🎨 Paint & Finishes';
    }
    if (matches('wire', 'light', 'switch', 'bulb', 'outlet', 'lamp', 'жица', 'лампа', 'крушк', 'контакт', 'осветлени')) {
      return '💡 Electrical & Lighting';
    }
    if (matches('pipe', 'faucet', 'drain', 'valve', 'sink', 'plumb', 'тръб', 'кран', 'сифон', 'мивк', 'канал', 'душ')) {
      return '🚰 Plumbing & Fixtures';
    }
    return '🪵 Materials & Supplies';
  }

  // 3. Work / Software / Project Sprint
  if (
    ctx.includes('sprint') ||
    ctx.includes('dev') ||
    ctx.includes('work') ||
    ctx.includes('launch') ||
    ctx.includes('project') ||
    ctx.includes('app') ||
    ctx.includes('feat') ||
    ctx.includes('qa') ||
    ctx.includes('tech') ||
    ctx.includes('release') ||
    ctx.includes('code') ||
    ctx.includes('проект') ||
    ctx.includes('работ')
  ) {
    if (matches('api', 'code', 'backend', 'frontend', 'db', 'bug', 'endpoint', 'код', 'бъг', 'база')) {
      return '💻 Engineering';
    }
    if (matches('test', 'qa', 'verify', 'check', 'audit', 'regression', 'тест', 'проверк')) {
      return '🧪 QA & Testing';
    }
    if (matches('design', 'figma', 'mockup', 'asset', 'icon', 'дизайн', 'икон') || /\bux\b/i.test(c) || /\bui\b/i.test(c)) {
      return '🎨 Design & UX';
    }
    if (matches('deploy', 'release', 'docker', 'server', 'ci', 'build', 'сървър')) {
      return '🚀 DevOps & Release';
    }
    return '📋 Planning & Tasks';
  }

  // 4. Shopping / Groceries (contextual or ingredient match)
  // 4a. Produce
  if (
    matches(
      'apple', 'banana', 'salad', 'herb', 'vegetable', 'veggie', 'fruit', 'onion', 'garlic', 'tomato',
      'potato', 'cucumber', 'pepper', 'carrot', 'spinach', 'mushroom', 'lettuce', 'avocado', 'orange',
      'lemon', 'lime', 'berry', 'grape', 'peach', 'melon', 'broccoli', 'zucchini',
      'домат', 'краставиц', 'чушк', 'пипер', 'лук', 'чесън', 'картоф', 'морков', 'ябълк', 'банан',
      'портокал', 'лимон', 'плод', 'зеленчук', 'салат', 'спанак', 'гъб', 'тиквички', 'патладжан',
      'зеле', 'магданоз', 'копър', 'авокадо', 'круш', 'ягод', 'грозде', 'прасков', 'диня', 'пъпеш', 'брокол'
    )
  ) {
    return '🥦 Produce';
  }

  // 4b. Dairy & Cold
  if (
    matches(
      'milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'tofu', 'sour cream', 'cottage',
      'мляк', 'сирен', 'кашкавал', 'масл', 'яйц', 'сметан', 'йогурт', 'извар', 'айрян', 'тофу'
    )
  ) {
    return '🥛 Dairy & Cold';
  }

  // 4c. Meat & Seafood
  if (
    matches(
      'chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'meat', 'turkey', 'lamb', 'shrimp', 'seafood',
      'bacon', 'sausage', 'ham', 'steak', 'patty', 'stew',
      'свинск', 'телешк', 'говежд', 'пилешк', 'пиле', 'кайм', 'мес', 'риб', 'сьомг', 'пъстърв',
      'лаврак', 'ципура', 'скарид', 'надениц', 'салам', 'шунк', 'бекон', 'пуешк', 'агнешк', 'суджук', 'яхния'
    )
  ) {
    return '🥩 Meat & Seafood';
  }

  // 4d. Bakery & Pantry
  if (
    matches(
      'bread', 'croissant', 'baguette', 'flour', 'pasta', 'spaghetti', 'noodle', 'rice', 'cereal', 'bagel',
      'sauce', 'snack', 'oil', 'olive oil', 'vinegar', 'salt', 'sugar', 'spice', 'bean', 'lentil',
      'honey', 'nut', 'cookie', 'biscuit', 'chocolate', 'coffee', 'tea', 'oat',
      'хляб', 'кроасан', 'багет', 'закуск', 'брашн', 'ориз', 'макарон', 'паст', 'спагет', 'олио',
      'зехтин', 'оцет', 'сол', 'захар', 'подправк', 'консерв', 'боб', 'леща', 'лютениц', 'сос',
      'мед', 'ядки', 'бисквит', 'шоколад', 'кафе', 'чай', 'овесен', 'сладкиш'
    )
  ) {
    return '🍞 Bakery & Pantry';
  }

  // 4e. Household
  if (
    matches(
      'soap', 'detergent', 'paper', 'sponge', 'clean', 'trash', 'napkin', 'tissue', 'toothpaste',
      'shampoo', 'bleach', 'foil',
      'сапун', 'препарат', 'прах', 'веро', 'хартия', 'салфетк', 'чувал', 'паста за зъби',
      'шампоан', 'душ гел', 'белина', 'фолио'
    )
  ) {
    return '🧼 Household';
  }

  // If context was explicitly shopping
  if (ctx.includes('shop') || ctx.includes('grocer') || ctx.includes('market') || ctx.includes('pantry') || ctx.includes('store') || ctx.includes('costco') || ctx.includes('пазар') || ctx.includes('покупк') || ctx.includes('магазин')) {
    return '🛒 Groceries';
  }

  // 5. Events / Parties
  if (ctx.includes('party') || ctx.includes('event') || ctx.includes('dinner') || ctx.includes('wedding') || ctx.includes('birthday') || ctx.includes('парти') || ctx.includes('рожден ден') || ctx.includes('сватб')) {
    if (matches('food', 'drink', 'cake', 'wine', 'beer', 'snack', 'cater', 'торта', 'вино', 'бира', 'сок', 'хапван')) {
      return '🍕 Food & Refreshments';
    }
    if (matches('invite', 'guest', 'rsvp', 'call', 'email', 'покан', 'гости')) {
      return '✉️ Invitations & Guests';
    }
    if (matches('decor', 'balloon', 'table', 'chair', 'flower', 'light', 'балон', 'цветя', 'украс')) {
      return '🎉 Decor & Venue';
    }
    return '🎵 Activities & Coordination';
  }

  return 'General';
}

/**
 * Synchronous classification for immediate rendering and sorting.
 * Prioritizes:
 * 1. Prefix tags ([Category] or Category:)
 * 2. In-memory / cached category
 * 3. Zero-shot contextual inference
 *
 * Store and task labels remain tags and do not hijack section headers.
 */
export function classifyTaskWithAI(task: Task, contextTitle?: string): string {
  // Check explicit title prefix first
  const manual = classifyTaskContextually(task, contextTitle);
  if (manual !== 'General') {
    return manual;
  }

  // Check memory cache
  const cacheKey = getCacheKey(task.project_id, task.id, contextTitle);
  if (memoryCategoryCache.has(cacheKey)) {
    return memoryCategoryCache.get(cacheKey)!;
  }

  // Contextual zero-shot inference
  const category = inferContextualCategory(task.title, contextTitle);
  memoryCategoryCache.set(cacheKey, category);
  return category;
}

/**
 * Asynchronously classifies tasks, persisting classifications into AsyncStorage.
 * If on-device Gemini Nano / window.ai.languageModel is available, it queries the prompt API.
 */
export async function classifyTasksWithAIAsync(
  tasks: Task[],
  contextTitle?: string
): Promise<Record<number, string>> {
  const results: Record<number, string> = {};
  const uncachedTasks: Task[] = [];

  for (const task of tasks) {
    const manual = classifyTaskContextually(task, contextTitle);
    if (manual !== 'General') {
      results[task.id] = manual;
      continue;
    }

    const cacheKey = getCacheKey(task.project_id, task.id, contextTitle);
    const inMem = memoryCategoryCache.get(cacheKey);
    if (inMem) {
      results[task.id] = inMem;
      continue;
    }

    // Try AsyncStorage
    try {
      const stored = await AsyncStorage.getItem(AI_CACHE_PREFIX + cacheKey);
      if (stored) {
        memoryCategoryCache.set(cacheKey, stored);
        results[task.id] = stored;
        continue;
      }
    } catch (_) {}

    uncachedTasks.push(task);
  }

  // For uncached items:
  // If window.ai / Gemini Nano Prompt API is available, invoke it
  const promptApi = (globalThis as any).ai?.languageModel || (typeof window !== 'undefined' && (window as any).ai?.languageModel);
  if (promptApi && uncachedTasks.length > 0) {
    try {
      const session = await promptApi.create({
        systemPrompt: `You are an on-device intelligent multilingual task assistant.
You understand all languages natively (Spanish, Bulgarian, English, French, German, Italian, etc.) and recognize descriptive phrases in any language.
For each item:
1. Detect its language and extract the core item from descriptive phrases (e.g. 'jamón ibérico para cenar' -> core: 'jamón ibérico', 'lechuga fresca' -> core: 'lechuga', 'свинско за яхния' -> core: 'свинско', 'мляко за кисело мляко' -> core: 'мляко', 'peeled garlic' -> core: 'garlic').
2. Assign each item to a concise category appropriate for the list context: "${contextTitle || 'Tasks'}".
3. Return output strictly in the format:
Item -> Category`,
      });
      const promptText = uncachedTasks.map((t) => t.title).join('\n');
      const response: string = await session.prompt(promptText);

      // Parse lines like "Milk -> Dairy"
      for (const line of response.split('\n')) {
        const parts = line.split('->');
        if (parts.length === 2) {
          const itemTitle = parts[0].trim().toLowerCase();
          const category = parts[1].trim();
          const matchedTask = uncachedTasks.find((t) => t.title.toLowerCase().includes(itemTitle));
          if (matchedTask) {
            results[matchedTask.id] = category;
            const cacheKey = getCacheKey(matchedTask.project_id, matchedTask.id, contextTitle);
            memoryCategoryCache.set(cacheKey, category);
            AsyncStorage.setItem(AI_CACHE_PREFIX + cacheKey, category).catch(() => {});
          }
        }
      }
    } catch (_) {
      // Fallback to contextual inference if prompt API call errors
    }
  }

  // For any tasks still without result, run inference
  for (const task of uncachedTasks) {
    if (!results[task.id]) {
      const category = inferContextualCategory(task.title, contextTitle);
      results[task.id] = category;
      const cacheKey = getCacheKey(task.project_id, task.id, contextTitle);
      memoryCategoryCache.set(cacheKey, category);
      AsyncStorage.setItem(AI_CACHE_PREFIX + cacheKey, category).catch(() => {});
    }
  }

  return results;
}

/**
 * Clears cached AI classifications.
 */
export async function clearAICoreCache(): Promise<void> {
  memoryCategoryCache.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const aiKeys = keys.filter((k) => k.startsWith(AI_CACHE_PREFIX));
    if (aiKeys.length > 0) {
      await AsyncStorage.multiRemove(aiKeys);
    }
  } catch (_) {}
}
