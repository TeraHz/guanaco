/**
 * Bidirectional normalization between Vikunja's TipTap HTML task descriptions
 * and clean, readable plain text / checklists on mobile.
 */

const HTML_TAG_DETECTOR = /<\/?(?:p|div|br|ul|ol|li|h[1-6]|blockquote|pre|code|strong|b|em|i|u|s|del|a|span|hr|table|thead|tbody|tr|th|td|input|label|script|style)\b[^>]*>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bull: '•',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
};

/**
 * Single-pass HTML entity decoder. Never double-unescapes `&amp;lt;`.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  return input.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z0-9]+));/g, (full, dec, hex, named) => {
    if (dec !== undefined) {
      const code = parseInt(dec, 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return full;
    }
    if (hex !== undefined) {
      const code = parseInt(hex, 16);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return full;
    }
    if (named !== undefined) {
      const lower = named.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower)) {
        return NAMED_ENTITIES[lower];
      }
    }
    return full;
  });
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function containsHtmlMarkup(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string') return false;
  return HTML_TAG_DETECTOR.test(raw);
}

function stripInlineTagsAndDecode(fragment: string): string {
  // Convert <a href="...">text</a> before stripping tags
  const withLinks = fragment.replace(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, dq, sq, uq, inner) => {
      const rawHref = decodeHtmlEntities((dq ?? sq ?? uq ?? '').trim());
      const label = decodeHtmlEntities(
        inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
      ).trim();
      if (!rawHref || /^(?:javascript|data|vbscript):/i.test(rawHref)) {
        return label;
      }
      if (!label || label === rawHref) {
        return rawHref;
      }
      return `${label} (${rawHref})`;
    }
  );

  const withBreaks = withLinks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return decodeHtmlEntities(withBreaks);
}

function convertListHtml(listHtml: string, ordered: boolean, isTaskList: boolean): string {
  const items: string[] = [];
  const liRegex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  let idx = 1;

  while ((match = liRegex.exec(listHtml)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';

    const hasTaskAttr = /\bdata-checked\s*=\s*["']?(true|false)["']?/i.exec(attrs);
    const hasCheckboxInput = /<input\b[^>]*type\s*=\s*["']?checkbox["']?[^>]*>/i.exec(inner);
    const itemIsTask = isTaskList || Boolean(hasTaskAttr) || Boolean(hasCheckboxInput);

    const cleanedText = stripInlineTagsAndDecode(inner)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');

    if (!cleanedText && !itemIsTask) continue;

    if (itemIsTask) {
      const isChecked =
        (hasTaskAttr && hasTaskAttr[1].toLowerCase() === 'true') ||
        (hasCheckboxInput && /\bchecked\b/i.test(hasCheckboxInput[0]));
      items.push(`- [${isChecked ? 'x' : ' '}] ${cleanedText}`.trimEnd());
    } else if (ordered) {
      items.push(`${idx++}. ${cleanedText}`);
    } else {
      items.push(`• ${cleanedText}`);
    }
  }

  return items.length > 0 ? `\n\n${items.join('\n')}\n\n` : '';
}

/**
 * Converts Vikunja HTML descriptions into clean, readable mobile text while leaving plain-text notes intact.
 */
export function htmlToPlainText(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  if (!containsHtmlMarkup(raw)) return raw;

  let working = raw
    .replace(/\r\n/g, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Process innermost <ul> / <ol> blocks iteratively (supports nested lists cleanly)
  const listPattern = /<(ul|ol)\b([^>]*)>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi;
  let safety = 0;
  while (listPattern.test(working) && safety < 10) {
    listPattern.lastIndex = 0;
    working = working.replace(listPattern, (_full, tag: string, attrs: string, body: string) => {
      const isOrdered = tag.toLowerCase() === 'ol';
      const isTask = /\bdata-type\s*=\s*["']?taskList["']?/i.test(attrs || '');
      return convertListHtml(body, isOrdered, isTask);
    });
    safety += 1;
  }

  // Convert remaining block boundaries before inline stripping
  working = working
    .replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n')
    .replace(/<\/(?:p|div|h[1-6]|blockquote|pre|table)>/gi, '\n\n')
    .replace(/<(?:p|div|h[1-6]|blockquote|pre|table)\b[^>]*>/gi, '');

  const decoded = stripInlineTagsAndDecode(working);

  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainTextToVikunjaHtml(rawText: string): string {
  const normalized = (rawText || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const blocks = normalized.split(/\n{2,}/);
  const htmlBlocks: string[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const allTaskItems = lines.every((l) => /^-\s*\[([ xX])\]\s+/.test(l));
    if (allTaskItems) {
      const items = lines
        .map((l) => {
          const m = l.match(/^-\s*\[([ xX])\]\s+(.*)$/)!;
          const checked = m[1].toLowerCase() === 'x' ? 'true' : 'false';
          return `<li data-checked="${checked}"><p>${escapeHtml(m[2].trim())}</p></li>`;
        })
        .join('');
      htmlBlocks.push(`<ul data-type="taskList">${items}</ul>`);
      continue;
    }

    const allBullets = lines.every((l) => /^(?:•|-|\*)\s+/.test(l));
    if (allBullets) {
      const items = lines
        .map((l) => `<li><p>${escapeHtml(l.replace(/^(?:•|-|\*)\s+/, '').trim())}</p></li>`)
        .join('');
      htmlBlocks.push(`<ul>${items}</ul>`);
      continue;
    }

    const allOrdered = lines.every((l) => /^\d+\.\s+/.test(l));
    if (allOrdered) {
      const items = lines
        .map((l) => `<li><p>${escapeHtml(l.replace(/^\d+\.\s+/, '').trim())}</p></li>`)
        .join('');
      htmlBlocks.push(`<ol>${items}</ol>`);
      continue;
    }

    const paragraphInner = lines.map((l) => escapeHtml(l)).join('<br>');
    htmlBlocks.push(`<p>${paragraphInner}</p>`);
  }

  return htmlBlocks.join('');
}

/**
 * Serializes user-edited plain text back to Vikunja's description field:
 * - Preserves `originalRaw` untouched when `isDirty === false` so unopened/unedited HTML never loses formatting.
 * - Preserves plain text when `originalRaw` was not HTML.
 * - Serializes paragraphs, bullets, numbered lists, and `- [x]` / `- [ ]` checklists into clean HTML when `originalRaw` was HTML.
 */
export function serializeDescriptionForServer(
  editedText: string,
  originalRaw?: string | null,
  isDirty = true
): string {
  if (!isDirty && originalRaw !== undefined && originalRaw !== null) {
    return originalRaw;
  }

  const normalized = (editedText || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  if (!containsHtmlMarkup(originalRaw)) {
    return normalized;
  }

  return plainTextToVikunjaHtml(normalized);
}
