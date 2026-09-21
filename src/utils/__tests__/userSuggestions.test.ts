import {
  extractMentionQuery,
  getUserSuggestions,
  replaceMentionQuery,
} from '../userSuggestions';
import { User } from '../../types/vikunja';

describe('userSuggestions utility', () => {
  const mockUsers: User[] = [
    { id: 1, username: 'terahz', name: 'Georgi Todorov' },
    { id: 2, username: 'alex', name: 'Alex Johnson' },
    { id: 3, username: 'alice', name: 'Alice Walker' },
    { id: 4, username: 'bob', name: 'Bob Smith' },
  ];

  describe('extractMentionQuery', () => {
    it('extracts partial username when user types @', () => {
      expect(extractMentionQuery('Task for @al')).toBe('al');
      expect(extractMentionQuery('Meeting with @')).toBe('');
      expect(extractMentionQuery('@tera')).toBe('tera');
    });

    it('returns null if there is no active mention query', () => {
      expect(extractMentionQuery('Buy milk for mom')).toBeNull();
      expect(extractMentionQuery('Meeting at 5pm')).toBeNull();
      expect(extractMentionQuery('test@example.com is an email')).toBeNull();
    });
  });

  describe('getUserSuggestions', () => {
    it('returns all users if mention query is empty @', () => {
      const suggestions = getUserSuggestions('', mockUsers);
      expect(suggestions).toHaveLength(4);
    });

    it('filters users by username or name prefix case-insensitively', () => {
      const suggestions = getUserSuggestions('al', mockUsers);
      // Matches 'alex' and 'alice'
      expect(suggestions.map((u) => u.username)).toEqual(['alex', 'alice']);

      const geo = getUserSuggestions('geo', mockUsers);
      // Matches 'terahz' by name 'Georgi Todorov'
      expect(geo.map((u) => u.username)).toEqual(['terahz']);
    });

    it('returns empty array if no user matches', () => {
      const suggestions = getUserSuggestions('unknown', mockUsers);
      expect(suggestions).toEqual([]);
    });
  });

  describe('replaceMentionQuery', () => {
    it('replaces active @query with chosen username and space', () => {
      const result = replaceMentionQuery('Task for @al', 'alex');
      expect(result).toBe('Task for @alex ');
    });

    it('works when @ is at the beginning of input', () => {
      const result = replaceMentionQuery('@t', 'terahz');
      expect(result).toBe('@terahz ');
    });
  });
});
