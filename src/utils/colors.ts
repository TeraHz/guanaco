/**
 * Color and contrast utility for Vikunja mobile app
 * Ensures labels match server colors and remain 100% legible on dark mode.
 */

// Curated palette of vibrant, high-contrast colors on dark themes (TickTick / iOS Human Interface Guidelines)
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

/**
 * Normalizes hex colors from Vikunja (which often lacks the `#` prefix)
 * Returns `#RRGGBB` or `#RGB` if valid, or `null` if invalid.
 */
export function normalizeHexColor(hex?: string): string | null {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.trim().replace(/^#/, '');

  // Valid 3, 6, or 8 character hex code
  if (/^[0-9A-Fa-f]{3}$/.test(clean) || /^[0-9A-Fa-f]{6}$/.test(clean)) {
    return `#${clean}`;
  }
  if (/^[0-9A-Fa-f]{8}$/.test(clean)) {
    return `#${clean.slice(0, 6)}`;
  }
  return null;
}

/**
 * Converts a hex color to rgba string
 */
export function hexToRgba(hex: string, alpha: number): string {
  const norm = normalizeHexColor(hex);
  if (!norm) return `rgba(10, 132, 255, ${alpha})`;

  let clean = norm.slice(1);
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }

  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Calculates relative luminance of a color
 */
export function getLuminance(hex: string): number {
  const norm = normalizeHexColor(hex);
  if (!norm) return 0;

  let clean = norm.slice(1);
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }

  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Checks if a color is too dark to be used as text / border on dark mode (#1E1E22)
 * In Vikunja, uncolored labels or default black (#000000) have luminance 0.
 */
export function isTooDarkForDarkTheme(hex?: string): boolean {
  const norm = normalizeHexColor(hex);
  if (!norm) return true;
  return getLuminance(norm) < 0.18;
}

/**
 * Produces a deterministic vibrant color from a string seed (e.g. label title)
 */
export function getDeterministicColor(seed: string): string {
  let hash = 0;
  const clean = seed.trim().toLowerCase();
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % VIBRANT_PALETTE.length;
  return VIBRANT_PALETTE[index];
}

/**
 * Resolves the display color for a label:
 * Uses server hex_color if present, valid, and visible; otherwise falls back to a deterministic color.
 */
export function getLabelColor(title: string, serverHex?: string): string {
  const norm = normalizeHexColor(serverHex);
  if (norm && !isTooDarkForDarkTheme(norm)) {
    return norm;
  }
  return getDeterministicColor(title);
}

/**
 * Computes complete badge styling for a label pill on dark theme
 */
export function getLabelBadgeStyles(title: string, serverHex?: string): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  const color = getLabelColor(title, serverHex);

  return {
    backgroundColor: hexToRgba(color, 0.22),
    borderColor: hexToRgba(color, 0.55),
    textColor: color,
  };
}
