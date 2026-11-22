import { User } from '../types/vikunja';

const ACTIVE_MENTION_REGEX = /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u;
const RESERVED_DATE_MENTIONS = new Set(['today', 'tomorrow', 'tonight']);

/**
 * Extracts an active mention query from the end of text (e.g. "Task for @al" -> "al").
 * Returns null if user is not actively typing a mention or typed a date shorthand (@today/@tomorrow/@tonight).
 */
export function extractMentionQuery(text: string): string | null {
  if (!text) return null;
  const match = text.match(ACTIVE_MENTION_REGEX);
  if (!match) return null;
  if (RESERVED_DATE_MENTIONS.has(match[1].toLowerCase())) {
    return null;
  }
  return match[1];
}

/**
 * Returns matching users from cache based on username or name prefix/substring.
 */
export function getUserSuggestions(query: string, cachedUsers: User[]): User[] {
  if (!Array.isArray(cachedUsers) || cachedUsers.length === 0) return [];
  const clean = (query || '').trim().toLowerCase();
  if (!clean) return cachedUsers;

  return cachedUsers.filter((u) => {
    if (!u?.username) return false;
    const matchUser = u.username.toLowerCase().includes(clean);
    const matchName = u.name ? u.name.toLowerCase().includes(clean) : false;
    return matchUser || matchName;
  });
}

/**
 * Replaces the active @query at the end of input with chosen username + trailing space.
 */
export function replaceMentionQuery(text: string, chosenUsername: string): string {
  if (!text) return '';
  const safeUser = (chosenUsername || '').replace(/"/g, '').trim();
  return text.replace(ACTIVE_MENTION_REGEX, (match) => {
    const leadingWsMatch = match.match(/^\s+/);
    const prefix = leadingWsMatch ? leadingWsMatch[0] : '';
    const formatted = /[\s*#+@!]/.test(safeUser)
      ? `@"${safeUser}" `
      : `@${safeUser} `;
    return `${prefix}${formatted}`;
  });
}
