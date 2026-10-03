import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isAICoreSupported,
  __setMockAICoreSupportedForTesting,
  inferContextualCategory,
  classifyTaskWithAI,
  classifyTasksWithAIAsync,
  clearAICoreCache,
} from '../aiCore';
import { Task } from '../../types/vikunja';

describe('AICore & On-Device ML Grouping', () => {
  afterEach(async () => {
    __setMockAICoreSupportedForTesting(null);
    await clearAICoreCache();
  });

  describe('isAICoreSupported() device detection', () => {
    it('returns false by default in standard test/mock environment without AICore', () => {
      expect(isAICoreSupported()).toBe(false);
    });

    it('returns true when simulated via testing helper', () => {
      __setMockAICoreSupportedForTesting(true);
      expect(isAICoreSupported()).toBe(true);

      __setMockAICoreSupportedForTesting(false);
      expect(isAICoreSupported()).toBe(false);
    });

    it('detects globalThis.ai.languageModel Prompt API', () => {
      const originalAi = (globalThis as any).ai;
      try {
        (globalThis as any).ai = { languageModel: {} };
        expect(isAICoreSupported()).toBe(true);
      } finally {
        (globalThis as any).ai = originalAi;
      }
    });

    it('detects Google Pixel with Tensor hardware on Android', () => {
      const originalOS = Platform.OS;
      const originalConstants = Platform.constants;
      try {
        Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
        Object.defineProperty(Platform, 'constants', {
          value: {
            Brand: 'Google',
            Manufacturer: 'Google',
            Model: 'Pixel 11 Pro',
          },
          configurable: true,
        });
        expect(isAICoreSupported()).toBe(true);

        Object.defineProperty(Platform, 'constants', {
          value: {
            Brand: 'Google',
            Manufacturer: 'Google',
            Model: 'Pixel 9',
          },
          configurable: true,
        });
        expect(isAICoreSupported()).toBe(true);

        // Non-Pixel or older Pixel
        Object.defineProperty(Platform, 'constants', {
          value: {
            Brand: 'Samsung',
            Manufacturer: 'Samsung',
            Model: 'Galaxy S21',
          },
          configurable: true,
        });
        expect(isAICoreSupported()).toBe(false);
      } finally {
        Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
        Object.defineProperty(Platform, 'constants', { value: originalConstants, configurable: true });
      }
    });
  });

  describe('extractCoreSubject() core item extraction', () => {
    const { extractCoreSubject } = require('../aiCore');

    it('extracts primary item from descriptive prepositional phrases in English and Bulgarian', () => {
      expect(extractCoreSubject('Milk for yogurt')).toBe('Milk');
      expect(extractCoreSubject('Мляко за кисело мляко')).toBe('Мляко');
      expect(extractCoreSubject('Pork for stew')).toBe('Pork');
      expect(extractCoreSubject('Свинско за яхния')).toBe('Свинско');
      expect(extractCoreSubject('Домати за салата')).toBe('Домати');
      expect(extractCoreSubject('Bread with seeds')).toBe('Bread');
      expect(extractCoreSubject('Хляб със семена')).toBe('Хляб');
    });

    it('strips preparation adjectives and leading quantities in English and Bulgarian', () => {
      expect(extractCoreSubject('peeled garlic')).toBe('garlic');
      expect(extractCoreSubject('белен чесън')).toBe('чесън');
      expect(extractCoreSubject('frozen croissants')).toBe('croissants');
      expect(extractCoreSubject('замразени кроасани')).toBe('кроасани');
      expect(extractCoreSubject('2 кг картофи')).toBe('картофи');
      expect(extractCoreSubject('500g кайма')).toBe('кайма');
      expect(extractCoreSubject('пресни яйца')).toBe('яйца');
      expect(extractCoreSubject('organic bananas')).toBe('bananas');
    });
  });

  describe('inferContextualCategory() across domains and languages (Bulgarian & English)', () => {
    it('groups Bulgarian grocery items with descriptive phrases accurately', () => {
      expect(inferContextualCategory('Мляко за кисело мляко', 'Пазаруване')).toBe('🥛 Dairy & Cold');
      expect(inferContextualCategory('Свинско за яхния', 'Седмичен пазар')).toBe('🥩 Meat & Seafood');
      expect(inferContextualCategory('Белен чесън', 'Покупки')).toBe('🥦 Produce');
      expect(inferContextualCategory('Замразени кроасани', 'Пазаруване')).toBe('🍞 Bakery & Pantry');
      expect(inferContextualCategory('Пресни яйца', 'Хранителен магазин')).toBe('🥛 Dairy & Cold');
      expect(inferContextualCategory('Телешко за готвене', 'Пазар')).toBe('🥩 Meat & Seafood');
      expect(inferContextualCategory('Домати за салата', 'Пазар')).toBe('🥦 Produce');
      expect(inferContextualCategory('2 кг картофи', 'Пазаруване')).toBe('🥦 Produce');
      expect(inferContextualCategory('Сапун за ръце', 'Пазар')).toBe('🧼 Household');
    });

    it('groups English grocery items with descriptive phrases accurately', () => {
      expect(inferContextualCategory('Milk for yogurt', 'Weekly Groceries')).toBe('🥛 Dairy & Cold');
      expect(inferContextualCategory('Pork for stew', 'Weekly Groceries')).toBe('🥩 Meat & Seafood');
      expect(inferContextualCategory('Peeled garlic', 'Weekly Groceries')).toBe('🥦 Produce');
      expect(inferContextualCategory('Frozen croissants', 'Weekly Groceries')).toBe('🍞 Bakery & Pantry');
      expect(inferContextualCategory('Organic Bananas', 'Weekly Groceries')).toBe('🥦 Produce');
      expect(inferContextualCategory('Almond Milk', 'Supermarket Run')).toBe('🥛 Dairy & Cold');
      expect(inferContextualCategory('Sourdough Bread', 'Costco Run')).toBe('🍞 Bakery & Pantry');
      expect(inferContextualCategory('Fresh Salmon Fillet', 'Market Pantry')).toBe('🥩 Meat & Seafood');
      expect(inferContextualCategory('Paper Towels', 'Store')).toBe('🧼 Household');
    });

    it('groups travel packing lists into intuitive categories', () => {
      expect(inferContextualCategory('Passport & ID', 'Trip to Tokyo')).toBe('📄 Travel & Documents');
      expect(inferContextualCategory('Паспорт', 'Пътуване до Токио')).toBe('📄 Travel & Documents');
      expect(inferContextualCategory('Warm Jacket', 'Trip to Tokyo')).toBe('🧳 Clothes & Wearables');
      expect(inferContextualCategory('Тениски за плаж', 'Почивка')).toBe('🧳 Clothes & Wearables');
      expect(inferContextualCategory('USB-C Laptop Charger', 'Packing for Vacation')).toBe('🔌 Electronics');
      expect(inferContextualCategory('Зарядно за телефон', 'Пътуване')).toBe('🔌 Electronics');
      expect(inferContextualCategory('Toothpaste & Sunscreen', 'Camping Trip')).toBe('💊 Toiletries & Health');
    });

    it('groups home renovation and DIY lists without grocery keywords', () => {
      expect(inferContextualCategory('Claw Hammer and Screws', 'Living Room Remodel')).toBe('🔨 Tools & Hardware');
      expect(inferContextualCategory('Чук и винтове', 'Ремонт на хола')).toBe('🔨 Tools & Hardware');
      expect(inferContextualCategory('Matte Wall Primer and Paint', 'DIY Bedroom Fix')).toBe('🎨 Paint & Finishes');
      expect(inferContextualCategory('Боя за стени', 'Ремонт')).toBe('🎨 Paint & Finishes');
      expect(inferContextualCategory('Ceiling Light Bulb and Wire', 'Home Renovation')).toBe('💡 Electrical & Lighting');
      expect(inferContextualCategory('Kitchen Sink Drain Pipe', 'Plumbing Remodel')).toBe('🚰 Plumbing & Fixtures');
    });

    it('groups software development and work sprint tasks', () => {
      expect(inferContextualCategory('Implement Auth API Endpoint', 'Sprint 42 Dev')).toBe('💻 Engineering');
      expect(inferContextualCategory('Export Figma Icons and Mockup', 'App Launch')).toBe('🎨 Design & UX');
      expect(inferContextualCategory('Verify Regression Suite', 'Release QA')).toBe('🧪 QA & Testing');
      expect(inferContextualCategory('Configure Docker Deployment Server', 'DevOps Sprint')).toBe('🚀 DevOps & Release');
    });

    it('falls back to General for unrecognized domain tasks', () => {
      expect(inferContextualCategory('Review quarterly goals', 'Personal')).toBe('General');
    });
  });

  describe('classifyTaskWithAI() and caching', () => {
    it('does not allow store/task labels to hijack category section', () => {
      const task: Task = {
        id: 1,
        title: 'Whole Milk',
        done: false,
        priority: 0,
        project_id: 1,
        labels: [{ id: 10, title: 'Costco' }],
      };
      // Store labels like #Costco stay tags and do not override category section
      expect(classifyTaskWithAI(task, 'Groceries')).toBe('🥛 Dairy & Cold');
    });

    it('prioritizes prefix tags like [Category] or Category:', () => {
      const task1: Task = { id: 2, title: '[Crucial] Tickets', done: false, priority: 0, project_id: 1 };
      expect(classifyTaskWithAI(task1, 'Trip')).toBe('Crucial');

      const task2: Task = { id: 3, title: 'Hardware: Long Screws', done: false, priority: 0, project_id: 1 };
      expect(classifyTaskWithAI(task2, 'Home')).toBe('Hardware');
    });

    it('asynchronously processes and stores classifications in AsyncStorage', async () => {
      const tasks: Task[] = [
        { id: 10, title: 'Passport', done: false, priority: 0, project_id: 5 },
        { id: 11, title: 'Heavy Boots', done: false, priority: 0, project_id: 5 },
      ];

      const results = await classifyTasksWithAIAsync(tasks, 'Flight Packing');
      expect(results[10]).toBe('📄 Travel & Documents');
      expect(results[11]).toBe('🧳 Clothes & Wearables');

      // Verify cached in AsyncStorage
      const stored = await AsyncStorage.getItem('@vikunja_aicore_cat_5_10_flight packing');
      expect(stored).toBe('📄 Travel & Documents');

      // Clear cache and verify removal
      await clearAICoreCache();
      const afterClear = await AsyncStorage.getItem('@vikunja_aicore_cat_5_10_flight packing');
      expect(afterClear).toBeNull();
    });

    it('uses on-device Gemini Nano Prompt API to classify multilingual items (Spanish, Bulgarian) zero-shot', async () => {
      const mockPromptSession = {
        prompt: jest.fn().mockResolvedValue(
          'jamón ibérico -> Carnes y Embutidos\nlechuga fresca -> Verduras\nсвинско за яхния -> Месо'
        ),
      };
      const originalAi = (globalThis as any).ai;
      (globalThis as any).ai = {
        languageModel: {
          create: jest.fn().mockResolvedValue(mockPromptSession),
        },
      };

      try {
        const tasks: Task[] = [
          { id: 201, title: 'jamón ibérico', done: false, priority: 0, project_id: 20 },
          { id: 202, title: 'lechuga fresca', done: false, priority: 0, project_id: 20 },
          { id: 203, title: 'свинско за яхния', done: false, priority: 0, project_id: 20 },
        ];

        const results = await classifyTasksWithAIAsync(tasks, 'Compras en España');

        expect((globalThis as any).ai.languageModel.create).toHaveBeenCalled();
        expect(results[201]).toBe('Carnes y Embutidos');
        expect(results[202]).toBe('Verduras');
        expect(results[203]).toBe('Месо');

        // Verify stored in cache
        const cachedJamon = await AsyncStorage.getItem('@vikunja_aicore_cat_20_201_compras en españa');
        expect(cachedJamon).toBe('Carnes y Embutidos');
      } finally {
        (globalThis as any).ai = originalAi;
      }
    });
  });
});
