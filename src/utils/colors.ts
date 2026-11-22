import { Label } from '../types/vikunja';

/**
 * Color and contrast utility for Vikunja mobile app.
 * Ensures labels and project dots match server colors (with `#` prefix) and remain 100% legible
 * across both Dark Mode and Light Mode.
 */

export const VIBRANT_PALETTE = [
  '#0A84FF', // Blue
  '#30D158', // Green
  '#FF9F0A', // Orange
  '#FF453A', // Red/Coral
  '#BF5AF2', // Purple
  '#5E5CE6', // Indigo
  '#64D2FF', // Cyan / Teal
  '#FF375F', // Pink
  '#FFD60A', // Yellow
  '#2ECC71', // Mint
  '#E67E22', // Amber
  '#1ABC9C', // Turquoise
];

function parseRgb(normHex: string): { r: number; g: number; b: number } {
  let clean = normHex.slice(1);
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Normalizes hex colors from Vikunja (which often omit the `#` prefix).
 * Returns `#RRGGBB` or `#RGB` if valid, or `undefined` if empty/invalid (or unset black when `ignoreBlackDefault` is true).
 */
export function normalizeHexColor(
  hex?: string | null,
  ignoreBlackDefault = false
): string | undefined {
  if (!hex || typeof hex !== 'string') return undefined;
  const clean = hex.trim().replace(/^#/, '');
  if (!clean) return undefined;

  let rgbPart = '';
  if (/^[0-9A-Fa-f]{3}$/.test(clean) || /^[0-9A-Fa-f]{6}$/.test(clean)) {
    rgbPart = clean;
  } else if (/^[0-9A-Fa-f]{8}$/.test(clean)) {
    const alpha = clean.slice(6, 8).toLowerCase();
    if (alpha === '00') return undefined;
    rgbPart = clean.slice(0, 6);
  } else {
    return undefined;
  }

  if (ignoreBlackDefault && /^0+$/.test(rgbPart)) {
    return undefined;
  }

  return `#${rgbPart}`;
}

/**
 * Convenience helper that normalizes a hex string and falls back to `fallback` if missing/invalid.
 */
export function ensureHexColor(
  hex?: string | null,
  fallback = '#007AFF',
  ignoreBlackDefault = false
): string {
  return normalizeHexColor(hex, ignoreBlackDefault) ?? fallback;
}

/**
 * Converts a hex color to rgba string.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  const norm = normalizeHexColor(hex);
  if (!norm) return `rgba(10, 132, 255, ${safeAlpha})`;

  const { r, g, b } = parseRgb(norm);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

/**
 * Calculates perceived luminance (0 = black, 1 = white).
 */
export function getLuminance(hex: string): number {
  const norm = normalizeHexColor(hex);
  if (!norm) return 0;

  const { r, g, b } = parseRgb(norm);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Checks if a color is too dark to be legible as text/border on Dark Mode (#1C1C1E).
 */
export function isTooDarkForDarkTheme(hex?: string | null): boolean {
  const norm = normalizeHexColor(hex);
  if (!norm) return true;
  return getLuminance(norm) < 0.18;
}

/**
 * Checks if a color is too bright/light (e.g. yellow #FFD60A, light cyan #64D2FF, white #FFFFFF)
 * to be legible as text on Light Mode white cards (#FFFFFF).
 */
export function isTooLightForLightTheme(hex?: string | null): boolean {
  const norm = normalizeHexColor(hex);
  if (!norm) return false;
  return getLuminance(norm) > 0.67;
}

/**
 * Adapts overly bright colors (such as yellow or white) to a legible darker shade for Light Mode
 * while preserving the color's hue whenever saturated.
 */
export function adaptColorForLightTheme(hex: string, fallbackSeed = ''): string {
  const norm = normalizeHexColor(hex);
  if (!norm) {
    const det = getDeterministicColor(fallbackSeed);
    return isTooLightForLightTheme(det) ? adaptColorForLightTheme(det, '') : det;
  }

  if (!isTooLightForLightTheme(norm)) {
    return norm;
  }

  const { r, g, b } = parseRgb(norm);
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);

  // Near-white achromatic color (#FFFFFF): use darkened deterministic hue if seed provided, else slate
  if (maxC - minC < 25) {
    if (fallbackSeed) {
      const det = getDeterministicColor(fallbackSeed);
      return adaptColorForLightTheme(det, '');
    }
    return '#3A3A3C';
  }

  const lum = getLuminance(norm);
  const scale = lum > 0 ? 0.44 / lum : 0.55;
  return rgbToHex(r * scale, g * scale, b * scale);
}

/**
 * Produces a deterministic vibrant color from a string seed (e.g. label title).
 */
export function getDeterministicColor(seed: string): string {
  let hash = 0;
  const clean = (seed || '').trim().toLowerCase();
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % VIBRANT_PALETTE.length;
  return VIBRANT_PALETTE[index];
}

/**
 * Resolves the display color for a label:
 * Uses server hex_color if present, valid, and not default unset black;
 * adapts contrast for Dark Mode (`isDark = true`) or Light Mode (`isDark = false`).
 */
export function getLabelColor(
  title: string,
  serverHex?: string | null,
  isDark = true
): string {
  const norm = normalizeHexColor(serverHex, true);
  if (norm) {
    if (isDark) {
      if (!isTooDarkForDarkTheme(norm)) return norm;
    } else {
      return isTooLightForLightTheme(norm) ? adaptColorForLightTheme(norm, title) : norm;
    }
  }

  const fallback = getDeterministicColor(title);
  return !isDark && isTooLightForLightTheme(fallback)
    ? adaptColorForLightTheme(fallback, '')
    : fallback;
}

/**
 * Resolves the canonical color for a label across Dark or Light theme.
 */
export function resolveCanonicalLabelColor(
  label: Label,
  labelDefinitions?: Label[],
  isDark = true
): string {
  if (!label) return getLabelColor('', undefined, isDark);

  if (Array.isArray(labelDefinitions) && labelDefinitions.length > 0) {
    const matched =
      label.id > 0 ? labelDefinitions.find((def) => def.id === label.id) : null;

    const matchedByTitle =
      matched ||
      labelDefinitions.find(
        (def) => (def.title || '').toLowerCase() === (label.title || '').toLowerCase()
      );

    if (matchedByTitle) {
      const defColor = matchedByTitle.color || matchedByTitle.hex_color;
      const normDef = normalizeHexColor(defColor, true);
      if (normDef) {
        if (isDark && !isTooDarkForDarkTheme(normDef)) {
          return normDef;
        }
        if (!isDark) {
          return isTooLightForLightTheme(normDef)
            ? adaptColorForLightTheme(normDef, label.title)
            : normDef;
        }
      }
    }
  }

  const directColor = label.color || label.hex_color;
  return getLabelColor(label.title, directColor, isDark);
}

/**
 * Computes complete badge styling for a label pill on Dark Mode (`isDark = true`)
 * or Light Mode (`isDark = false`).
 */
export function getLabelBadgeStyles(
  titleOrLabel: string | Label,
  serverHexOrDefs?: string | Label[] | null,
  isDark = true
): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  let color: string;
  if (typeof titleOrLabel === 'object' && titleOrLabel !== null) {
    const defs = Array.isArray(serverHexOrDefs) ? serverHexOrDefs : undefined;
    color = resolveCanonicalLabelColor(titleOrLabel, defs, isDark);
  } else {
    const serverHex = typeof serverHexOrDefs === 'string' ? serverHexOrDefs : undefined;
    color = getLabelColor(typeof titleOrLabel === 'string' ? titleOrLabel : '', serverHex, isDark);
  }

  if (!isDark) {
    return {
      backgroundColor: hexToRgba(color, 0.14),
      borderColor: hexToRgba(color, 0.45),
      textColor: color,
    };
  }

  return {
    backgroundColor: hexToRgba(color, 0.22),
    borderColor: hexToRgba(color, 0.55),
    textColor: color,
  };
}
