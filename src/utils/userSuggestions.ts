import { User } from '../types/vikunja';

/**
 * Extracts an active mention query from the end of text (e.g. "Task for @al" -> "al")
 * Returns null if user is not actively typing a mention.
 */
export function extractMentionQuery(text: string): string | null {
  // Matches '@' preceded by start of string or whitespace, followed by word chars
  const match = text.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
  if (!match) return null;
  return match[1];
}

/**
 * Returns matching users from cache based on username or name prefix/substring.
 */
export function getUserSuggestions(query: string, cachedUsers: User[]): User[] {
  if (!Array.isArray(cachedUsers) || cachedUsers.length === 0) return [];
  const clean = query.trim().toLowerCase();
  if (!clean) return cachedUsers;

  return cachedUsers.filter((u) => {
    const matchUser = u.username.toLowerCase().includes(clean);
    const matchName = u.name ? u.name.toLowerCase().includes(clean) : false;
    return matchUser || matchName;
  });
}

/**
 * Replaces the active @query at the end of input with chosen username + trailing space
 */
export function replaceMentionQuery(text: string, chosenUsername: string): string {
  return text.replace(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/, (match) => {
    const prefix = match.startsWith(' ') ? ' ' : '';
    return `${prefix}@${chosenUsername} `;
  });
}
