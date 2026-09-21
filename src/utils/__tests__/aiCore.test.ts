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

  describe('inferContextualCategory() across domains', () => {
    it('groups travel packing lists into intuitive categories', () => {
      expect(inferContextualCategory('Passport & ID', 'Trip to Tokyo')).toBe('📄 Travel & Documents');
      expect(inferContextualCategory('Warm Jacket', 'Trip to Tokyo')).toBe('🧳 Clothes & Wearables');
      expect(inferContextualCategory('USB-C Laptop Charger', 'Packing for Vacation')).toBe('🔌 Electronics');
      expect(inferContextualCategory('Toothpaste & Sunscreen', 'Camping Trip')).toBe('💊 Toiletries & Health');
    });

    it('groups home renovation and DIY lists without grocery keywords', () => {
      expect(inferContextualCategory('Claw Hammer and Screws', 'Living Room Remodel')).toBe('🔨 Tools & Hardware');
      expect(inferContextualCategory('Matte Wall Primer and Paint', 'DIY Bedroom Fix')).toBe('🎨 Paint & Finishes');
      expect(inferContextualCategory('Ceiling Light Bulb and Wire', 'Home Renovation')).toBe('💡 Electrical & Lighting');
      expect(inferContextualCategory('Kitchen Sink Drain Pipe', 'Plumbing Remodel')).toBe('🚰 Plumbing & Fixtures');
    });

    it('groups software development and work sprint tasks', () => {
      expect(inferContextualCategory('Implement Auth API Endpoint', 'Sprint 42 Dev')).toBe('💻 Engineering');
      expect(inferContextualCategory('Export Figma Icons and Mockup', 'App Launch')).toBe('🎨 Design & UX');
      expect(inferContextualCategory('Verify Regression Suite', 'Release QA')).toBe('🧪 QA & Testing');
      expect(inferContextualCategory('Configure Docker Deployment Server', 'DevOps Sprint')).toBe('🚀 DevOps & Release');
    });

    it('groups shopping lists contextually', () => {
      expect(inferContextualCategory('Organic Bananas', 'Weekly Groceries')).toBe('🥦 Produce');
      expect(inferContextualCategory('Almond Milk', 'Supermarket Run')).toBe('🥛 Dairy & Cold');
      expect(inferContextualCategory('Sourdough Bread', 'Costco Run')).toBe('🍞 Bakery & Pantry');
      expect(inferContextualCategory('Fresh Salmon Fillet', 'Market Pantry')).toBe('🥩 Meat & Seafood');
      expect(inferContextualCategory('Paper Towels', 'Store')).toBe('🧼 Household');
    });

    it('falls back to General for unrecognized domain tasks', () => {
      expect(inferContextualCategory('Review quarterly goals', 'Personal')).toBe('General');
    });
  });

  describe('classifyTaskWithAI() and caching', () => {
    it('prioritizes explicit labels on task', () => {
      const task: Task = {
        id: 1,
        title: 'Random Item',
        done: false,
        priority: 0,
        project_id: 1,
        labels: [{ id: 10, title: 'Urgent Action' }],
      };
      expect(classifyTaskWithAI(task, 'Trip')).toBe('Urgent Action');
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
  });
});
