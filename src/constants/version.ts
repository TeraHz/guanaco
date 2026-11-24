export const APP_VERSION = '1.5.0';
export const APP_BUILD_NUMBER = 10500;
export const APP_NAME = 'Guanaco';
/**
 * Decodes an encoded Mmmpp Android versionCode (major * 10000 + minor * 100 + patch, >= 10000)
 * into a human-readable semantic version string (e.g. 10401 -> "1.4.1").
 * Returns null for legacy sequential versionCodes (< 10000) or missing values.
 */
export function versionFromCode(versionCode?: number | null): string | null {
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode < 10000) {
    return null;
  }
  const major = Math.floor(versionCode / 10000);
  const minor = Math.floor((versionCode % 10000) / 100);
  const patch = versionCode % 100;
  return `${major}.${minor}.${patch}`;
}
