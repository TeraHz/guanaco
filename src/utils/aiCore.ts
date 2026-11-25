import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '../types/vikunja';
import { classifyTaskContextually, isShoppingList } from './smartClassifier';

const AI_CACHE_PREFIX = '@vikunja_aicore_cat_';

let mockAICoreSupported: boolean | null = null;

/**
 * Testing helper to simulate devices with/without Smart Grouping enabled.
 */
export function __setMockAICoreSupportedForTesting(supported: boolean | null) {
  mockAICoreSupported = supported;
}

/**
 * Kept as a false-returning compatibility stub: Smart Grouping runs 100% via deterministic
 * local on-device heuristics across all Android, iOS, and Web targets without external or browser AI APIs.
 */
export function isPromptAPIAvailable(): boolean {
  return false;
}

export const hasPromptApiSupport = isPromptAPIAvailable;

/**
 * Returns true on all platforms because local on-device heuristic Smart Grouping works fast
 * and 100% offline on every Android and iOS phone and tablet.
 */
export function isAICoreSupported(): boolean {
  if (mockAICoreSupported !== null) {
    return mockAICoreSupported;
  }
  return true;
}

// Separate bounded caches so synchronous heuristics never shadow persisted AsyncStorage / Prompt API classifications
const MAX_AI_MEMORY_CACHE_ENTRIES = 1000;
const asyncVerifiedCache = new Map<string, string>();
const heuristicSyncCache = new Map<string, string>();

function setBoundedCache(map: Map<string, string>, key: string, value: string): void {
  if (map.has(key)) {
    map.delete(key);
  } else {
    while (map.size >= MAX_AI_MEMORY_CACHE_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }
  map.set(key, value);
}

function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function capKeySegment(segment: string, maxLen: number): string {
  if (segment.length <= maxLen) return segment;
  return `${segment.slice(0, maxLen - 9)}_${fnv1aHex(segment)}`;
}

export function getAICacheKey(
  projectId: number | undefined,
  taskId: number,
  taskTitle: string,
  contextTitle?: string
): string {
  const normCtx = capKeySegment(
    (typeof contextTitle === 'string' ? contextTitle : '').trim().toLowerCase().replace(/\s+/g, ' '),
    64
  );
  const normTitle = capKeySegment(
    (typeof taskTitle === 'string' ? taskTitle : '').trim().toLowerCase().replace(/\s+/g, ' '),
    80
  );
  return `${projectId ?? 0}_${taskId}_${normCtx}_${normTitle}`;
}

const CANONICAL_CATEGORY_ALIASES: Record<string, string> = {
  produce: '🥦 Produce',
  'fruits & vegetables': '🥦 Produce',
  dairy: '🥛 Dairy & Cold',
  'dairy & cold': '🥛 Dairy & Cold',
  meat: '🥩 Meat & Seafood',
  seafood: '🥩 Meat & Seafood',
  'meat & seafood': '🥩 Meat & Seafood',
  bakery: '🍞 Bakery & Pantry',
  pantry: '🍞 Bakery & Pantry',
  'bakery & pantry': '🍞 Bakery & Pantry',
  household: '🧼 Household',
  groceries: '🛒 Groceries',
  'travel & documents': '📄 Travel & Documents',
  'clothes & wearables': '🧳 Clothes & Wearables',
  electronics: '🔌 Electronics',
  'toiletries & health': '💊 Toiletries & Health',
  'gear & essentials': '🎒 Gear & Essentials',
  'tools & hardware': '🔨 Tools & Hardware',
  'paint & finishes': '🎨 Paint & Finishes',
  'electrical & lighting': '💡 Electrical & Lighting',
  'plumbing & fixtures': '🚰 Plumbing & Fixtures',
  'materials & supplies': '🪵 Materials & Supplies',
  engineering: '💻 Engineering',
  'qa & testing': '🧪 QA & Testing',
  'design & ux': '🎨 Design & UX',
  'devops & release': '🚀 DevOps & Release',
  'planning & tasks': '📋 Planning & Tasks',
};

/**
 * Canonicalizes standard category names so manual prefixes like `[Produce]` and AI-inferred
 * `🥦 Produce` map to the same canonical section header instead of creating alternating split headers,
 * while preserving custom user prefixes (like `[Crucial]`, `[Deli]`, `Hardware:`) verbatim.
 */
export function canonicalizeCategory(category: string): string {
  if (typeof category !== 'string') return 'General';
  const trimmed = category.trim();
  if (!trimmed) return 'General';
  const stripped = trimmed.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CANONICAL_CATEGORY_ALIASES, stripped)) {
    return CANONICAL_CATEGORY_ALIASES[stripped];
  }
  return trimmed;
}

const IGNORED_COLON_IN_CORE = /^(re|fw|fwd|note|notes|todo|todos|fixme|wip|fyi|nb|ps)$/i;

/**
 * Extracts the core subject/ingredient from descriptive phrases.
 * Bounds length and collapses whitespace upfront to guarantee linear-time O(N) execution.
 */
export function extractCoreSubject(title: string): string {
  if (typeof title !== 'string') return '';
  const boundedRaw = title.slice(0, 500).replace(/\s+/g, ' ').trim();
  let cleaned = boundedRaw;
  if (!cleaned) return '';

  // 1. Remove bracketed / colon prefix tags: "[Bakery] Croissant" -> "Croissant"
  cleaned = cleaned.replace(/^\[[^\]]{2,25}\]\s+/u, '');
  const colonMatch = cleaned.match(/^([\p{L}][\p{L}\p{N}\s&/-]{1,20}):\s+(.*)$/u);
  if (colonMatch && !IGNORED_COLON_IN_CORE.test(colonMatch[1].trim())) {
    cleaned = colonMatch[2];
  }

  // 2. Remove leading quantities & units (English, Bulgarian & Spanish)
  cleaned = cleaned.replace(
    /^(\d+([.,]\d+)?\s*(кг|г|гр|мл|л|бр|пакет|пакета|кутия|кутии|kg|g|ml|l|lbs?|oz|pcs?|cans?|bottles?|packs?|boxes?|uds?|paquetes?|cajas?|latas?|botellas?|piezas?)(?:\.|\s+|$)\s*(на\s+|of\s+|de\s+)?)/iu,
    ''
  );
  cleaned = cleaned.replace(/^\d+\s+/, '');

  // 3. Handle prepositional intent clauses: "X for Y", "X за Y", "X para Y"
  const prepMatch = cleaned.match(/^(.+?)\s+(for|за|para|pour|с|със|with|con|avec)\s+/iu);
  if (prepMatch && prepMatch[1] && prepMatch[1].trim().length > 1) {
    cleaned = prepMatch[1].trim();
  }

  // 4. Strip common descriptive / preparation adjectives at the start
  const adjRegex =
    /^(peeled|fresh|frozen|roasted|baked|raw|organic|whole|skim|sliced|chopped|diced|minced|ground|homemade|белен|белени|белено|пресен|пресни|прясно|замразен|замразени|замразено|печен|печени|печено|суров|сурови|сурово|био|пълномаслен|пълномаслено|обезмаслен|обезмаслено|нарязан|нарязани|млян|мляно|мляна|домашен|домашно|домашни|frescos?|frescas?|congelados?|congeladas?|asados?|asadas?|org[aá]nicos?|org[aá]nicas?|integrales?|integral|desnatados?|desnatadas?|picados?|picadas?|molidos?|molidas?|caseros?|caseras?)\s+/iu;

  cleaned = cleaned.replace(adjRegex, '').trim();

  return cleaned.length > 0 ? cleaned : boundedRaw;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const compiledWordListCache = new Map<string, RegExp>();
const compiledStemListCache = new Map<string, RegExp>();

/**
 * Matches whole words (with optional English plural -s/-es/-ies) using Unicode boundaries
 * so "ham" never matches "shampoo", "tea" never matches "team"/"steak", "nut" never matches "minutes",
 * "oat" never matches "coat", and "oil" never matches "toilet".
 */
function hasAnyWord(texts: string[], words: string[]): boolean {
  if (words.length === 0) return false;
  const cacheKey = words.join('\0');
  let re = compiledWordListCache.get(cacheKey);
  if (!re) {
    const allAlts: string[] = [];
    for (const w of words) {
      const escaped = escapeRegex(w);
      allAlts.push(escaped, `${escaped}s`, `${escaped}es`);
      if (w.length >= 2 && /[^aeiou]y$/i.test(w)) {
        allAlts.push(`${escapeRegex(w.slice(0, -1))}ies`);
      }
    }
    re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(?:${allAlts.join('|')})(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );
    compiledWordListCache.set(cacheKey, re);
  }
  return texts.some((txt) => re!.test(txt));
}

/**
 * Matches Slavic / longer morphological stems at a WORD START boundary `(?:^|[^\p{L}\p{N}])`
 * so stems match inflected endings (e.g. "кроасан" -> "кроасани") without matching inside unrelated words.
 */
function hasAnyWordStem(texts: string[], stems: string[]): boolean {
  if (stems.length === 0) return false;
  const cacheKey = stems.join('\0');
  let re = compiledStemListCache.get(cacheKey);
  if (!re) {
    re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(?:${stems.map(escapeRegex).join('|')})`,
      'iu'
    );
    compiledStemListCache.set(cacheKey, re);
  }
  return texts.some((txt) => re!.test(txt));
}

/**
 * Contextual zero-shot semantic grouping for arbitrary task lists using strict word-boundary rules.
 */
export function inferContextualCategory(title: string, contextTitle?: string): string {
  if (!title || typeof title !== 'string') return 'General';
  const safeTitle = title.slice(0, 500).replace(/\s+/g, ' ').trim();
  if (!safeTitle) return 'General';
  const core = extractCoreSubject(safeTitle);
  const texts = [core.toLowerCase(), safeTitle.toLowerCase()];
  const ctx = (typeof contextTitle === 'string' ? contextTitle : '')
    .slice(0, 200)
    .replace(/\s+/g, ' ')
    .trim();
  const ctxTexts = [ctx.toLowerCase()];

  // 1. Travel / Packing
  const isTravelCtx =
    /\b(trip|trips|pack|packing|travel|traveling|travelling|vacation|vacations|flight|flights|camp|camping|luggage|itinerary|viajes?|equipaje|maletas?|vacaciones|vuelos?|itinerario)\b/iu.test(ctx) ||
    hasAnyWordStem(ctxTexts, ['пътуван', 'почивк', 'куфар', 'екскурзи', 'ваканци']) ||
    hasAnyWord(ctxTexts, ['път']);

  if (isTravelCtx) {
    if (
      hasAnyWord(texts, ['passport', 'ticket', 'visa', 'doc', 'docs', 'document', 'insurance', 'hotel', 'reservation', 'boarding pass', 'pasaporte', 'boleto', 'billete', 'documento', 'seguro', 'reserva', 'tarjeta de embarque']) ||
      hasAnyWordStem(texts, ['паспорт', 'билет', 'виза', 'документ', 'резерваци', 'застраховк'])
    ) {
      return '📄 Travel & Documents';
    }
    if (
      hasAnyWord(texts, ['shirt', 't-shirt', 'pant', 'pants', 'jeans', 'shorts', 'sock', 'shoe', 'boot', 'jacket', 'hat', 'coat', 'underwear', 'clothes', 'clothing', 'dress', 'swimsuit', 'sweater', 'hoodie', 'camisa', 'camiseta', 'pantalón', 'pantalon', 'pantalones', 'calcetín', 'calcetines', 'zapato', 'bota', 'chaqueta', 'abrigo', 'ropa', 'vestido', 'bañador', 'suéter']) ||
      hasAnyWordStem(texts, ['дрех', 'тениск', 'риза', 'ризи', 'панталон', 'чорап', 'обувк', 'яке', 'палто', 'бански', 'шапк'])
    ) {
      return '🧳 Clothes & Wearables';
    }
    if (
      hasAnyWord(texts, ['charger', 'cable', 'phone', 'laptop', 'adapter', 'battery', 'batteries', 'headphone', 'earbuds', 'powerbank', 'power bank', 'camera', 'cargador', 'teléfono', 'telefono', 'portátil', 'portatil', 'adaptador', 'batería', 'bateria', 'auriculares', 'cámara', 'camara', 'linterna']) ||
      hasAnyWordStem(texts, ['зарядн', 'кабел', 'телефон', 'лаптоп', 'адаптер', 'батери', 'слушалк'])
    ) {
      return '🔌 Electronics';
    }
    if (
      hasAnyWord(texts, ['toothbrush', 'hairbrush', 'brush', 'soap', 'shampoo', 'conditioner', 'medicine', 'medication', 'meds', 'pill', 'toothpaste', 'sunscreen', 'towel', 'deodorant', 'razor', 'cepillo', 'jabón', 'jabon', 'champú', 'champu', 'medicamento', 'medicina', 'pastilla', 'protector solar', 'bloqueador', 'toalla', 'desodorante']) ||
      hasAnyWordStem(texts, ['четк', 'сапун', 'шампоан', 'паста за зъби', 'лекарств', 'хапчет', 'кърп', 'дезодорант', 'слънцезащит'])
    ) {
      return '💊 Toiletries & Health';
    }
    return '🎒 Gear & Essentials';
  }

  // 2. Work / Software / Project Sprint (evaluated BEFORE DIY so "Bug Fix" / "Hotfix" lists stay Engineering;
  // strict word boundaries ensure \bapp\b never matches "Apples" or "Appliances")
  const isWorkDevCtx =
    /\b(sprint|sprints|dev|devops|developer|development|work|launch|feature|features|qa|tech|engineering|release|code|coding|software|app|apps|backend|frontend|bug|bugs|hotfix|hotfixes|trabajo|desarrollo|ingenier[ií]a|lanzamiento|c[oó]digo)\b/iu.test(ctx) ||
    hasAnyWordStem(ctxTexts, ['софтуер', 'разработк']) ||
    hasAnyWord(ctxTexts, ['работа', 'работни']);

  if (isWorkDevCtx) {
    if (
      hasAnyWord(texts, ['api', 'code', 'backend', 'frontend', 'db', 'database', 'bug', 'endpoint', 'auth', 'refactor', 'migration', 'código', 'codigo', 'base de datos', 'migración', 'migracion']) ||
      hasAnyWord(texts, ['код', 'бъг', 'база'])
    ) {
      return '💻 Engineering';
    }
    if (
      hasAnyWord(texts, ['test', 'testing', 'qa', 'verify', 'verification', 'check', 'audit', 'regression', 'e2e', 'jest', 'prueba', 'auditoría', 'auditoria', 'verificación', 'verificacion']) ||
      hasAnyWordStem(texts, ['тест', 'проверк'])
    ) {
      return '🧪 QA & Testing';
    }
    if (
      hasAnyWord(texts, ['design', 'figma', 'mockup', 'wireframe', 'asset', 'icon', 'ux', 'ui', 'typography', 'diseño', 'diseno', 'icono', 'maqueta', 'interfaz']) ||
      hasAnyWordStem(texts, ['дизайн', 'икон', 'макет'])
    ) {
      return '🎨 Design & UX';
    }
    if (
      hasAnyWord(texts, ['deploy', 'deployment', 'release', 'docker', 'kubernetes', 'server', 'ci', 'cd', 'build', 'pipeline', 'despliegue', 'servidor']) ||
      hasAnyWordStem(texts, ['сървър', 'деплой'])
    ) {
      return '🚀 DevOps & Release';
    }
    return '📋 Planning & Tasks';
  }

  // 3. DIY / Home Renovation / Hardware (no .* regex backtracking)
  const isDiyCtx =
    /\b(remodel\w*|diy|renovat\w*|plumb\w*|garden\w*|handyman|hardware|reforma\w*|bricolaje|reparaci[oó]n\w*|jard[ií]n\w*|ferreter[ií]a)\b/iu.test(ctx) ||
    (/\b(home|bedroom|kitchen|bathroom|garage|living\s+room|casa|hogar|cocina|baño|garaje)\b/iu.test(ctx) &&
      /\b(remodel\w*|renovat\w*|fix\w*|repair\w*|arregl\w*|repar\w*)\b/iu.test(ctx)) ||
    /\b(fix|repair|arreglar|reparar)\b/iu.test(ctx) ||
    hasAnyWordStem(ctxTexts, ['ремонт', 'майстор', 'градин']);

  if (isDiyCtx) {
    if (
      hasAnyWord(texts, ['hammer', 'drill', 'screw', 'nail', 'saw', 'tape', 'wrench', 'pliers', 'screwdriver', 'level', 'martillo', 'taladro', 'tornillo', 'clavo', 'sierra', 'llave', 'destornillador', 'nivel']) ||
      hasAnyWordStem(texts, ['чук', 'бормашин', 'винт', 'пирон', 'трион', 'клещи', 'отвертк'])
    ) {
      return '🔨 Tools & Hardware';
    }
    if (
      hasAnyWord(texts, ['paint', 'primer', 'brush', 'paintbrush', 'roller', 'sandpaper', 'finish', 'stain', 'varnish', 'caulk', 'pintura', 'imprimación', 'brocha', 'rodillo', 'lija', 'barniz', 'silicona']) ||
      hasAnyWordStem(texts, ['боя', 'бои', 'грунд', 'лак', 'четк', 'валяк', 'шкурк'])
    ) {
      return '🎨 Paint & Finishes';
    }
    if (
      hasAnyWord(texts, ['wire', 'wiring', 'light', 'switch', 'bulb', 'outlet', 'lamp', 'breaker', 'fixture', 'cableado', 'luz', 'interruptor', 'bombilla', 'enchufe', 'lámpara', 'lampara']) ||
      hasAnyWordStem(texts, ['жица', 'жици', 'лампа', 'лампи', 'крушк', 'контакт', 'осветлени'])
    ) {
      return '💡 Electrical & Lighting';
    }
    if (
      hasAnyWord(texts, ['pipe', 'faucet', 'drain', 'valve', 'sink', 'plumbing', 'toilet', 'shower', 'gasket', 'tubería', 'tuberia', 'grifo', 'desagüe', 'válvula', 'valvula', 'fregadero', 'fontanería', 'fontaneria', 'inodoro', 'ducha']) ||
      hasAnyWordStem(texts, ['тръб', 'кран', 'сифон', 'мивк', 'канал', 'душ', 'тоалетн'])
    ) {
      return '🚰 Plumbing & Fixtures';
    }
    return '🪵 Materials & Supplies';
  }

  const isShoppingCtx = isShoppingList(ctx);

  // 4. Shopping / Groceries (word-boundary matched to avoid false positives on general lists!)
  // Check Household BEFORE Pantry so "паста за зъби" / "toothpaste" / "shampoo" never hit "паст" or "ham".
  if (
    hasAnyWord(texts, [
      'soap', 'dish soap', 'detergent', 'sponge', 'cleaner', 'cleaning supplies',
      'trash bag', 'garbage bag', 'paper towel', 'toilet paper', 'parchment paper',
      'napkin', 'tissue', 'toothpaste', 'shampoo', 'conditioner', 'bleach', 'aluminum foil', 'tin foil',
      'сапун', 'веро', 'белина', 'фолио',
      'jabón', 'jabon', 'detergente', 'esponja', 'limpiador', 'bolsa de basura', 'papel higiénico',
      'papel higienico', 'papel de cocina', 'servilleta', 'pañuelo', 'pasta de dientes', 'dentífrico',
      'champú', 'champu', 'acondicionador', 'lejía', 'lejia', 'papel de aluminio',
    ]) ||
    hasAnyWordStem(texts, [
      'препарат', 'прах за пране', 'салфетк', 'тоалетна хартия', 'кухненска ролка',
      'паста за зъби', 'шампоан', 'душ гел', 'чували за смет',
    ]) ||
    (isShoppingCtx && (hasAnyWord(texts, ['paper', 'trash', 'foil', 'хартия', 'papel', 'basura']) || hasAnyWordStem(texts, ['чувал'])))
  ) {
    return '🧼 Household';
  }

  // 4a. Produce
  if (
    hasAnyWord(texts, [
      'apple', 'banana', 'salad', 'herb', 'vegetable', 'veggie', 'fruit', 'onion', 'garlic', 'tomato',
      'potato', 'potatoes', 'tomatoes', 'cucumber', 'pepper', 'carrot', 'spinach', 'mushroom', 'lettuce',
      'avocado', 'orange', 'lemon', 'lime', 'berry', 'cherry', 'strawberry', 'blueberry',
      'raspberry', 'blackberry', 'cranberry', 'grape', 'peach', 'pear', 'melon', 'watermelon',
      'broccoli', 'zucchini', 'celery', 'cabbage', 'cauliflower', 'cilantro', 'parsley', 'dill', 'basil',
      'лук', 'чесън', 'зеленчук', 'зеленчуци', 'плод', 'плодове', 'копър', 'магданоз', 'авокадо', 'грозде', 'диня', 'пъпеш', 'зеле',
      'manzana', 'plátano', 'platano', 'ensalada', 'verdura', 'fruta', 'cebolla', 'ajo', 'tomate',
      'patata', 'papa', 'pepino', 'pimiento', 'zanahoria', 'espinaca', 'champiñón', 'champiñones',
      'lechuga', 'aguacate', 'palta', 'naranja', 'limón', 'limon', 'lima', 'cereza', 'fresa', 'frutilla',
      'arándano', 'arandano', 'frambuesa', 'uva', 'melocotón', 'durazno', 'pera', 'melón', 'sandía', 'sandia',
      'brócoli', 'brocoli', 'calabacín', 'calabacin', 'apio', 'coliflor', 'perejil', 'eneldo', 'albahaca',
    ]) ||
    hasAnyWordStem(texts, [
      'домат', 'краставиц', 'чушк', 'пипер', 'картоф', 'морков', 'ябълк', 'банан',
      'портокал', 'лимон', 'салат', 'спанак', 'гъб', 'тиквички', 'тиквичка', 'патладжан',
      'круш', 'ягод', 'прасков', 'брокол',
    ])
  ) {
    return '🥦 Produce';
  }

  // 4b. Dairy & Cold
  if (
    hasAnyWord(texts, [
      'milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'sour cream', 'cottage cheese',
      'egg', 'tofu', 'kefir', 'mozzarella', 'cheddar', 'parmesan', 'feta',
      'айрян', 'тофу', 'яйце', 'яйца',
      'leche', 'queso', 'yogur', 'mantequilla', 'nata', 'crema', 'requesón', 'requeson', 'huevo', 'kéfir',
    ]) ||
    hasAnyWordStem(texts, [
      'мляк', 'млек', 'сирен', 'кашкавал', 'краве масл', 'масло', 'сметан', 'йогурт', 'извар',
    ])
  ) {
    return '🥛 Dairy & Cold';
  }

  // 4c. Meat & Seafood (strict whole-word \bham\b so "Buy shampoo" or "hammer" never match!)
  if (
    hasAnyWord(texts, [
      'chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'meat', 'turkey', 'lamb', 'shrimp', 'seafood',
      'bacon', 'sausage', 'ham', 'steak', 'patty', 'patties', 'fillet', 'prosciutto', 'salami',
      'пиле', 'месо', 'меса', 'риба', 'риби', 'лаврак', 'ципура', 'бекон', 'суджук', 'яхния',
      'pollo', 'carne', 'ternera', 'res', 'cerdo', 'pescado', 'salmón', 'atún', 'atun', 'pavo',
      'cordero', 'gamba', 'camarón', 'camaron', 'marisco', 'tocino', 'panceta', 'salchicha', 'chorizo',
      'jamón', 'jamon', 'filete', 'bistec', 'lomo',
    ]) ||
    (isShoppingCtx && hasAnyWord(texts, ['stew', 'estofado'])) ||
    hasAnyWordStem(texts, [
      'свинск', 'телешк', 'говежд', 'пилешк', 'кайм', 'сьомг', 'пъстърв',
      'скарид', 'надениц', 'салам', 'шунк', 'пуешк', 'агнешк', 'кюфте', 'кебапч', 'пържол',
    ])
  ) {
    return '🥩 Meat & Seafood';
  }

  // 4d. Bakery & Pantry (strict whole-word \btea\b, \bnut\b, \boat\b, \boil\b, \brice\b!)
  if (
    hasAnyWord(texts, [
      'bread', 'sourdough', 'loaf', 'croissant', 'baguette', 'pastry', 'flour', 'pasta', 'spaghetti', 'noodle', 'rice', 'cereal', 'bagel',
      'sauce', 'snack', 'oil', 'olive oil', 'vinegar', 'salt', 'sugar', 'spice', 'bean', 'lentil',
      'honey', 'nut', 'almond', 'walnut', 'cashew', 'peanut', 'pistachio', 'cookie', 'biscuit',
      'chocolate', 'coffee', 'tea', 'oat', 'oatmeal', 'granola', 'jam', 'tortilla', 'cracker',
      'хляб', 'багет', 'ориз', 'олио', 'зехтин', 'оцет', 'сол', 'захар', 'боб', 'леща', 'сос',
      'мед', 'ядки', 'шоколад', 'кафе', 'чай',
      'pan', 'hogaza', 'cruasán', 'bollería', 'bolleria', 'harina', 'espagueti', 'fideo', 'arroz',
      'cereales', 'salsa', 'aceite', 'aceite de oliva', 'vinagre', 'sal', 'azúcar', 'azucar', 'especia',
      'frijol', 'frijoles', 'alubia', 'garbanzo', 'lenteja', 'miel', 'nuez', 'nueces', 'almendra',
      'cacahuete', 'maní', 'galleta', 'café', 'cafe', 'té', 'avena', 'mermelada',
    ]) ||
    hasAnyWordStem(texts, [
      'кроасан', 'закуск', 'брашн', 'макарон', 'спагет', 'подправк', 'консерв',
      'лютениц', 'бисквит', 'овесен', 'сладкиш', 'козунак', 'баниц',
    ])
  ) {
    return '🍞 Bakery & Pantry';
  }

  if (isShoppingCtx) {
    return '🛒 Groceries';
  }

  // 5. Events / Parties
  const isEventCtx =
    /\b(party|parties|event|events|dinner|wedding|weddings|birthday|birthdays|celebration|fiestas?|eventos?|cenas?|bodas?|cumpleaños|celebraci[oó]n)\b/iu.test(ctx) ||
    hasAnyWordStem(ctxTexts, ['парти', 'рожден ден', 'сватб', 'празник']);

  if (isEventCtx) {
    if (
      hasAnyWord(texts, ['food', 'drink', 'cake', 'wine', 'beer', 'snack', 'catering', 'champagne', 'dessert', 'comida', 'bebida', 'pastel', 'tarta', 'vino', 'cerveza', 'aperitivo', 'champán', 'postre']) ||
      hasAnyWordStem(texts, ['торта', 'вино', 'бира', 'сок', 'хапван', 'напитк'])
    ) {
      return '🍕 Food & Refreshments';
    }
    if (
      hasAnyWord(texts, ['invite', 'invitation', 'guest', 'rsvp', 'call', 'email', 'invitación', 'invitacion', 'invitado', 'confirmar']) ||
      hasAnyWordStem(texts, ['покан', 'гости', 'гост'])
    ) {
      return '✉️ Invitations & Guests';
    }
    if (
      hasAnyWord(texts, ['decor', 'decoration', 'balloon', 'table', 'chair', 'flower', 'light', 'music', 'decoración', 'decoracion', 'globo', 'mesa', 'silla', 'flor', 'flores', 'música', 'musica']) ||
      hasAnyWordStem(texts, ['балон', 'цветя', 'украс'])
    ) {
      return '🎉 Decor & Venue';
    }
    return '🎵 Activities & Coordination';
  }

  return 'General';
}

/**
 * Synchronous classification for immediate rendering and sorting.
 * Prioritizes:
 * 1. Explicit prefix tags (`[Category]` or `Category:`), canonicalized against standard sections
 * 2. Async-verified category cache (`AsyncStorage`)
 * 3. Zero-shot contextual inference
 */
export function classifyTaskWithAI(task: Task, contextTitle?: string): string {
  if (!task?.title) return 'General';

  const manual = classifyTaskContextually(task, contextTitle);
  if (manual !== 'General') {
    return canonicalizeCategory(manual);
  }

  const cacheKey = getAICacheKey(task.project_id, task.id, task.title, contextTitle);
  if (asyncVerifiedCache.has(cacheKey)) {
    return asyncVerifiedCache.get(cacheKey)!;
  }
  if (heuristicSyncCache.has(cacheKey)) {
    return heuristicSyncCache.get(cacheKey)!;
  }

  const category = inferContextualCategory(task.title, contextTitle);
  setBoundedCache(heuristicSyncCache, cacheKey, category);
  return category;
}

/**
 * Asynchronously classifies tasks, batching reads with `AsyncStorage.multiGet`,
 * applying deterministic on-device contextual heuristics, and persisting classifications.
 */
export async function classifyTasksWithAIAsync(
  tasks: Task[],
  contextTitle?: string
): Promise<Record<number, string>> {
  const results: Record<number, string> = {};
  if (!Array.isArray(tasks) || tasks.length === 0) return results;

  const storageLookupTasks: { task: Task; cacheKey: string; storageKey: string }[] = [];

  for (const task of tasks) {
    if (!task?.title) continue;
    const manual = classifyTaskContextually(task, contextTitle);
    if (manual !== 'General') {
      results[task.id] = canonicalizeCategory(manual);
      continue;
    }

    const cacheKey = getAICacheKey(task.project_id, task.id, task.title, contextTitle);
    const inAsyncMem = asyncVerifiedCache.get(cacheKey);
    if (inAsyncMem) {
      results[task.id] = inAsyncMem;
      continue;
    }

    storageLookupTasks.push({
      task,
      cacheKey,
      storageKey: AI_CACHE_PREFIX + cacheKey,
    });
  }

  const uncachedTasks: Task[] = [];

  if (storageLookupTasks.length > 0) {
    try {
      const storageKeys = storageLookupTasks.map((entry) => entry.storageKey);
      const pairs = await AsyncStorage.multiGet(storageKeys);
      const storedMap = new Map<string, string>();
      if (Array.isArray(pairs)) {
        for (const [k, v] of pairs) {
          if (k && v) storedMap.set(k, v);
        }
      }

      for (const entry of storageLookupTasks) {
        const stored = storedMap.get(entry.storageKey);
        if (stored) {
          setBoundedCache(asyncVerifiedCache, entry.cacheKey, stored);
          setBoundedCache(heuristicSyncCache, entry.cacheKey, stored);
          results[entry.task.id] = stored;
        } else {
          uncachedTasks.push(entry.task);
        }
      }
    } catch (_) {
      for (const entry of storageLookupTasks) {
        uncachedTasks.push(entry.task);
      }
    }
  }

  const entriesToPersist: [string, string][] = [];

  for (const task of uncachedTasks) {
    if (!results[task.id]) {
      const category = inferContextualCategory(task.title, contextTitle);
      results[task.id] = category;
      const cacheKey = getAICacheKey(task.project_id, task.id, task.title, contextTitle);
      setBoundedCache(asyncVerifiedCache, cacheKey, category);
      setBoundedCache(heuristicSyncCache, cacheKey, category);
      entriesToPersist.push([AI_CACHE_PREFIX + cacheKey, category]);
    }
  }

  if (entriesToPersist.length > 0) {
    try {
      await AsyncStorage.multiSet(entriesToPersist);
    } catch (_) {
      for (const [k, v] of entriesToPersist) {
        AsyncStorage.setItem(k, v).catch(() => {});
      }
    }
  }

  return results;
}

/**
 * Clears cached AI classifications in memory and AsyncStorage.
 */
export async function clearAICoreCache(): Promise<void> {
  asyncVerifiedCache.clear();
  heuristicSyncCache.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const aiKeys = keys.filter((k) => k.startsWith(AI_CACHE_PREFIX));
    if (aiKeys.length > 0) {
      await AsyncStorage.multiRemove(aiKeys);
    }
  } catch (_) {}
}
