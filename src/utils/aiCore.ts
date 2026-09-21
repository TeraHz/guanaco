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
 * Contextual zero-shot semantic grouping for arbitrary task lists without hardcoding ingredients.
 * Determines the category based on context heuristics (Travel, DIY/Home, Tech/Dev, Events, Shopping, General).
 */
export function inferContextualCategory(title: string, contextTitle?: string): string {
  const t = title.toLowerCase();
  const ctx = (contextTitle || '').toLowerCase();

  // 1. Travel / Packing
  if (ctx.includes('trip') || ctx.includes('pack') || ctx.includes('travel') || ctx.includes('vacation') || ctx.includes('flight') || ctx.includes('camp')) {
    if (t.includes('passport') || t.includes('ticket') || t.includes('visa') || t.includes('doc') || t.includes('insurance') || t.includes('hotel') || t.includes('reservation')) {
      return '📄 Travel & Documents';
    }
    if (t.includes('shirt') || t.includes('pant') || t.includes('sock') || t.includes('shoe') || t.includes('boot') || t.includes('jacket') || t.includes('hat') || t.includes('coat') || t.includes('wear') || t.includes('clothes')) {
      return '🧳 Clothes & Wearables';
    }
    if (t.includes('charger') || t.includes('cable') || t.includes('phone') || t.includes('laptop') || t.includes('adapter') || t.includes('battery') || t.includes('headphone')) {
      return '🔌 Electronics';
    }
    if (t.includes('brush') || t.includes('soap') || t.includes('shampoo') || t.includes('med') || t.includes('pill') || t.includes('paste') || t.includes('sunscreen') || t.includes('towel')) {
      return '💊 Toiletries & Health';
    }
    return '🎒 Gear & Essentials';
  }

  // 2. DIY / Home Renovation / Hardware
  if (ctx.includes('remodel') || ctx.includes('diy') || ctx.includes('renov') || ctx.includes('build') || ctx.includes('home') || ctx.includes('fix') || ctx.includes('garden')) {
    if (t.includes('hammer') || t.includes('drill') || t.includes('screw') || t.includes('nail') || t.includes('saw') || t.includes('tape') || t.includes('wrench')) {
      return '🔨 Tools & Hardware';
    }
    if (t.includes('paint') || t.includes('primer') || t.includes('brush') || t.includes('roller') || t.includes('sandpaper') || t.includes('finish')) {
      return '🎨 Paint & Finishes';
    }
    if (t.includes('wire') || t.includes('light') || t.includes('switch') || t.includes('bulb') || t.includes('outlet') || t.includes('lamp')) {
      return '💡 Electrical & Lighting';
    }
    if (t.includes('pipe') || t.includes('faucet') || t.includes('drain') || t.includes('valve') || t.includes('sink') || t.includes('plumb')) {
      return '🚰 Plumbing & Fixtures';
    }
    return '🪵 Materials & Supplies';
  }

  // 3. Work / Software / Project Sprint
  if (ctx.includes('sprint') || ctx.includes('dev') || ctx.includes('work') || ctx.includes('launch') || ctx.includes('project') || ctx.includes('app') || ctx.includes('feat') || ctx.includes('qa') || ctx.includes('tech') || ctx.includes('release') || ctx.includes('code')) {
    if (t.includes('api') || t.includes('code') || t.includes('backend') || t.includes('frontend') || t.includes('db') || t.includes('bug') || t.includes('endpoint')) {
      return '💻 Engineering';
    }
    if (t.includes('test') || t.includes('qa') || t.includes('verify') || t.includes('check') || t.includes('audit') || t.includes('regression')) {
      return '🧪 QA & Testing';
    }
    if (t.includes('design') || t.includes('figma') || /\bux\b/i.test(t) || /\bui\b/i.test(t) || t.includes('mockup') || t.includes('asset') || t.includes('icon')) {
      return '🎨 Design & UX';
    }
    if (t.includes('deploy') || t.includes('release') || t.includes('docker') || t.includes('server') || t.includes('ci') || t.includes('build')) {
      return '🚀 DevOps & Release';
    }
    return '📋 Planning & Tasks';
  }

  // 4. Shopping / Groceries (contextual fallback)
  if (ctx.includes('shop') || ctx.includes('grocer') || ctx.includes('market') || ctx.includes('pantry') || ctx.includes('store') || ctx.includes('costco')) {
    if (t.includes('apple') || t.includes('banana') || t.includes('salad') || t.includes('herb') || t.includes('vegetable') || t.includes('fruit') || t.includes('onion') || t.includes('garlic') || t.includes('tomato')) {
      return '🥦 Produce';
    }
    if (t.includes('milk') || t.includes('cheese') || t.includes('yogurt') || t.includes('butter') || t.includes('cream') || t.includes('egg')) {
      return '🥛 Dairy & Cold';
    }
    if (t.includes('bread') || t.includes('flour') || t.includes('pasta') || t.includes('rice') || t.includes('cereal') || t.includes('bagel') || t.includes('sauce') || t.includes('snack')) {
      return '🍞 Bakery & Pantry';
    }
    if (t.includes('chicken') || t.includes('beef') || t.includes('pork') || t.includes('fish') || t.includes('salmon') || t.includes('meat') || t.includes('turkey')) {
      return '🥩 Meat & Seafood';
    }
    if (t.includes('soap') || t.includes('detergent') || t.includes('paper') || t.includes('sponge') || t.includes('clean') || t.includes('trash')) {
      return '🧼 Household';
    }
    return '🛒 Groceries';
  }

  // 5. Events / Parties
  if (ctx.includes('party') || ctx.includes('event') || ctx.includes('dinner') || ctx.includes('wedding') || ctx.includes('birthday')) {
    if (t.includes('food') || t.includes('drink') || t.includes('cake') || t.includes('wine') || t.includes('beer') || t.includes('snack') || t.includes('cater')) {
      return '🍕 Food & Refreshments';
    }
    if (t.includes('invite') || t.includes('guest') || t.includes('rsvp') || t.includes('call') || t.includes('email')) {
      return '✉️ Invitations & Guests';
    }
    if (t.includes('decor') || t.includes('balloon') || t.includes('table') || t.includes('chair') || t.includes('flower') || t.includes('light')) {
      return '🎉 Decor & Venue';
    }
    return '🎵 Activities & Coordination';
  }

  return 'General';
}

/**
 * Synchronous classification for immediate rendering and sorting.
 * Prioritizes:
 * 1. Labels
 * 2. Prefix tags ([Category] or Category:)
 * 3. In-memory / cached category
 * 4. Zero-shot contextual inference
 */
export function classifyTaskWithAI(task: Task, contextTitle?: string): string {
  // Check label or prefix first
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
        systemPrompt: `You group tasks into concise categories based on list context "${contextTitle || 'General'}". Return items in format: TaskName -> Category`,
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
