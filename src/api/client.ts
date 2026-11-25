import { Platform } from 'react-native';
import {
  AuthTokens,
  CreateProjectInput,
  CreateTaskInput,
  Label,
  Permission,
  Project,
  ProjectTeamShare,
  ProjectUserShare,
  ProjectView,
  Task,
  TaskRelation,
  TaskRelationKind,
  Team,
  UpdateProjectInput,
  UpdateTaskInput,
  User,
} from '../types/vikunja';
import { isPersonalApiToken } from '../utils/biometrics';
import { isZeroDate } from '../utils/dates';
import { APP_NAME, APP_VERSION } from '../constants/version';
import { t } from '../i18n';

export interface VikunjaClientConfig {
  baseUrl: string;
  token?: string;
  refreshToken?: string | null;
  timeoutMs?: number;
  sessionSignal?: AbortSignal;
  onUnauthorized?: () => void;
  onTokenRefresh?: () => Promise<string | null>;
  onRefreshTokenUpdated?: (refreshToken: string | null) => Promise<void> | void;
  onTransientRefreshFailure?: () => void;
}

export class VikunjaApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: any,
    public isProxyError?: boolean
  ) {
    super(message);
    this.name = 'VikunjaApiError';
  }
}

export interface ParsedServerUrl {
  serverUrl: string;
  apiBaseUrl: string;
  isInsecureHttp: boolean;
}

export interface ParsedHttpUrl {
  protocol: 'http:' | 'https:';
  hostname: string;
  port: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  href: string;
}

function isValidIpv4Address(addr: string): boolean {
  const octets = addr.split('.');
  if (octets.length !== 4) return false;
  return octets.every((o) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(o)) return false;
    const n = Number(o);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/**
 * Pure RFC 4291 IPv6 parser + RFC 5952 canonical serializer.
 * Parses 8x 16-bit words (including IPv4-mapped tails) and formats lowercase hex without leading zeros,
 * compressing the longest run of >= 2 zero words to `::` (leftmost on tie).
 */
function parseAndCanonicalizeIpv6(addr: string): string | null {
  if (!addr || /[^0-9a-fA-F:.]/.test(addr)) return null;
  if (
    (addr.startsWith(':') && !addr.startsWith('::')) ||
    (addr.endsWith(':') && !addr.endsWith('::'))
  ) {
    return null;
  }

  const doubleColonParts = addr.split('::');
  if (doubleColonParts.length > 2) return null;

  const hasCompression = doubleColonParts.length === 2;
  const leftRaw = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const rightRaw = hasCompression && doubleColonParts[1] ? doubleColonParts[1].split(':') : [];

  let ipv4Words: number[] = [];
  const tailSegments = hasCompression ? rightRaw : leftRaw;
  if (tailSegments.length > 0 && tailSegments[tailSegments.length - 1].includes('.')) {
    const ipv4Tail = tailSegments.pop()!;
    if (!isValidIpv4Address(ipv4Tail)) return null;
    const octs = ipv4Tail.split('.').map((o) => Number(o));
    ipv4Words = [((octs[0] << 8) | octs[1]) & 0xffff, ((octs[2] << 8) | octs[3]) & 0xffff];
  }

  const isHexGroup = (g: string) => /^[0-9a-fA-F]{1,4}$/.test(g);
  if (!leftRaw.every(isHexGroup) || !rightRaw.every(isHexGroup)) {
    return null;
  }

  const leftWords = leftRaw.map((g) => parseInt(g, 16));
  const rightWords = [
    ...rightRaw.map((g) => parseInt(g, 16)),
    ...(hasCompression ? ipv4Words : []),
  ];
  const uncompressedLeftWords = hasCompression ? leftWords : [...leftWords, ...ipv4Words];

  let words: number[];
  if (hasCompression) {
    const provided = leftWords.length + rightWords.length;
    if (provided > 7) return null;
    const zeroPad = new Array<number>(8 - provided).fill(0);
    words = [...leftWords, ...zeroPad, ...rightWords];
  } else {
    if (uncompressedLeftWords.length !== 8) return null;
    words = uncompressedLeftWords;
  }

  // RFC 5952 §4.2: compress longest run of >= 2 consecutive 0 words (leftmost on tie)
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen += 1;
      }
      if (curLen >= 2 && curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestStart !== -1 && bestLen >= 2) {
    const leftHex = words
      .slice(0, bestStart)
      .map((w) => w.toString(16))
      .join(':');
    const rightHex = words
      .slice(bestStart + bestLen)
      .map((w) => w.toString(16))
      .join(':');
    return `${leftHex}::${rightHex}`;
  }

  return words.map((w) => w.toString(16)).join(':');
}

/**
 * RFC 3986 §5.2.4 dot-segment path normalization.
 */
function normalizeUrlPath(rawPath: string): string {
  if (!rawPath) return '/';
  const withLeadingSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const hasTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/');
  const segments = withLeadingSlash.split('/');
  const out: string[] = [];
  let endedOnDotSegment = false;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '.') {
      endedOnDotSegment = true;
    } else if (seg === '..') {
      out.pop();
      endedOnDotSegment = true;
    } else {
      if (seg === '' && i === segments.length - 1) {
        continue;
      }
      out.push(seg);
      endedOnDotSegment = false;
    }
  }

  const joined = `/${out.join('/')}`;
  if ((hasTrailingSlash || endedOnDotSegment) && !joined.endsWith('/')) {
    return `${joined}/`;
  }
  return joined;
}

/**
 * Pure RFC 3986 HTTP(S) URL parser & validator with zero reliance on React Native's `Libraries/Blob/URL.js` polyfill.
 * - Case-insensitive `http://` / `https://` scheme handling
 * - Splits authority strictly before the first `/`, `?`, or `#` so `@` in path/query/hash is permitted
 *   while `user@host` in authority is rejected with `urlError.embeddedCredentials`
 * - Supports bracketed RFC 4291 IPv6 literals (`[::1]:3456`), IPv4 octet validation, DNS label normalization,
 *   port `1..65535` validation, and default port stripping (`:80` on `http:`, `:443` on `https:`)
 */
export function parseHttpUrl(
  rawInput: string,
  options?: { defaultHttpsIfMissingScheme?: boolean }
): ParsedHttpUrl {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!trimmed) {
    throw new Error(t('urlError.required'));
  }

  if (trimmed.startsWith('//') || trimmed.startsWith('://')) {
    throw new Error(t('urlError.invalid'));
  }

  if (/[\u0000-\u0020\u007f]/.test(trimmed)) {
    throw new Error(t('urlError.invalidFormat'));
  }

  const explicitSchemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  let protocol: 'http:' | 'https:';
  let rest: string;

  if (explicitSchemeMatch) {
    const proto = explicitSchemeMatch[1].toLowerCase();
    if (proto !== 'http' && proto !== 'https') {
      throw new Error(t('urlError.unsupportedScheme', { proto }));
    }
    protocol = `${proto}:` as 'http:' | 'https:';
    rest = trimmed.slice(explicitSchemeMatch[0].length);
  } else {
    if (/^(javascript|data|vbscript|file|mailto|about|blob):/i.test(trimmed)) {
      throw new Error(t('urlError.invalidScheme'));
    }
    if (!options?.defaultHttpsIfMissingScheme) {
      const bareScheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
      if (bareScheme) {
        const proto = bareScheme[1].toLowerCase();
        if (proto !== 'http' && proto !== 'https') {
          throw new Error(t('urlError.unsupportedScheme', { proto }));
        }
      }
      throw new Error(t('urlError.invalidScheme'));
    }
    // Reject non-authority schemes like `ftp:foo` while permitting `localhost:3456` or `example.com:8080`
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d+(?:[/?#]|$))/.test(trimmed)) {
      throw new Error(t('urlError.invalidScheme'));
    }
    protocol = 'https:';
    rest = trimmed;
  }

  let boundaryIdx = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '/' || ch === '?' || ch === '#') {
      boundaryIdx = i;
      break;
    }
  }

  const authority = rest.slice(0, boundaryIdx);
  const tail = rest.slice(boundaryIdx);

  if (!authority) {
    throw new Error(t('urlError.invalidFormat'));
  }

  if (authority.includes('@')) {
    throw new Error(t('urlError.embeddedCredentials'));
  }

  if (authority.includes('\\')) {
    throw new Error(t('urlError.invalidHostname'));
  }

  let hostname = '';
  let rawPort = '';
  let hasExplicitPort = false;

  if (authority.startsWith('[')) {
    const closeIdx = authority.indexOf(']');
    if (closeIdx === -1) {
      throw new Error(t('urlError.invalidHostname'));
    }
    const ipv6Inner = authority.slice(1, closeIdx);
    const afterBracket = authority.slice(closeIdx + 1);
    const canonicalIpv6 = parseAndCanonicalizeIpv6(ipv6Inner);
    if (!canonicalIpv6) {
      throw new Error(t('urlError.invalidHostname'));
    }
    if (afterBracket) {
      if (!afterBracket.startsWith(':')) {
        throw new Error(t('urlError.invalidFormat'));
      }
      rawPort = afterBracket.slice(1);
      if (!rawPort) {
        throw new Error(t('urlError.invalidPort'));
      }
      hasExplicitPort = true;
    }
    hostname = `[${canonicalIpv6}]`;
  } else {
    if (authority.includes('[') || authority.includes(']')) {
      throw new Error(t('urlError.invalidHostname'));
    }
    const firstColon = authority.indexOf(':');
    if (firstColon !== -1 && authority.indexOf(':', firstColon + 1) !== -1) {
      // Unbracketed IPv6 or multiple colons in authority
      throw new Error(t('urlError.invalidFormat'));
    }

    const rawHost = firstColon === -1 ? authority : authority.slice(0, firstColon);
    if (firstColon !== -1) {
      rawPort = authority.slice(firstColon + 1);
      if (!rawPort) {
        throw new Error(t('urlError.invalidPort'));
      }
      hasExplicitPort = true;
    }

    const lowerHost = rawHost.trim().toLowerCase();
    if (
      !lowerHost ||
      lowerHost.includes('..') ||
      lowerHost.startsWith('.') ||
      lowerHost.endsWith('.')
    ) {
      throw new Error(t('urlError.invalidHostname'));
    }

    if (/^\d+(\.\d+)*$/.test(lowerHost)) {
      if (!isValidIpv4Address(lowerHost)) {
        throw new Error(t('urlError.invalidIpv4'));
      }
    } else {
      const labels = lowerHost.split('.');
      const validLabels = labels.every(
        (lbl) =>
          lbl.length > 0 &&
          lbl.length <= 63 &&
          /^[a-z0-9-]+$/.test(lbl) &&
          !lbl.startsWith('-') &&
          !lbl.endsWith('-')
      );
      if (!validLabels) {
        throw new Error(t('urlError.invalidHostname'));
      }
      if (/^(?:\d+|0x[0-9a-f]+)$/i.test(labels[labels.length - 1])) {
        throw new Error(t('urlError.invalidHostname'));
      }
      if (labels.length < 2 && lowerHost !== 'localhost' && !hasExplicitPort) {
        throw new Error(t('urlError.enterValidDomain'));
      }
    }
    hostname = lowerHost;
  }

  let port = '';
  if (hasExplicitPort) {
    if (!/^\d+$/.test(rawPort)) {
      throw new Error(t('urlError.invalidPort'));
    }
    const portNum = Number(rawPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(t('urlError.invalidPort'));
    }
    const isDefaultPort =
      (protocol === 'http:' && portNum === 80) || (protocol === 'https:' && portNum === 443);
    port = isDefaultPort ? '' : String(portNum);
  }

  const host = port ? `${hostname}:${port}` : hostname;
  const origin = `${protocol}//${host}`;

  const hashIdx = tail.indexOf('#');
  const beforeHash = hashIdx === -1 ? tail : tail.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : tail.slice(hashIdx);
  const queryIdx = beforeHash.indexOf('?');
  const rawPathname = queryIdx === -1 ? beforeHash : beforeHash.slice(0, queryIdx);
  const search = queryIdx === -1 ? '' : beforeHash.slice(queryIdx);
  const pathname = rawPathname ? normalizeUrlPath(rawPathname) : '/';
  const href = `${origin}${pathname}${search}${hash}`;

  return {
    protocol,
    hostname,
    port,
    host,
    pathname,
    search,
    hash,
    origin,
    href,
  };
}

/**
 * Resolves an HTTP redirect `Location` header against `baseUrlStr` using RFC 3986 reference resolution.
 */
export function resolveHttpRedirectUrl(location: string, baseUrlStr: string): string {
  const base = parseHttpUrl(baseUrlStr, { defaultHttpsIfMissingScheme: false });
  const trimmedLoc = typeof location === 'string' ? location.trim() : '';
  if (!trimmedLoc) {
    return base.href;
  }

  if (trimmedLoc.split(/[?#]/)[0].includes('\\')) {
    throw new Error(t('urlError.invalidFormat'));
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmedLoc)) {
    return parseHttpUrl(trimmedLoc, { defaultHttpsIfMissingScheme: false }).href;
  }

  if (trimmedLoc.startsWith('//')) {
    return parseHttpUrl(`${base.protocol}${trimmedLoc}`, { defaultHttpsIfMissingScheme: false }).href;
  }

  if (trimmedLoc.startsWith('#')) {
    return parseHttpUrl(`${base.origin}${base.pathname}${base.search}${trimmedLoc}`, {
      defaultHttpsIfMissingScheme: false,
    }).href;
  }

  if (trimmedLoc.startsWith('?')) {
    return parseHttpUrl(`${base.origin}${base.pathname}${trimmedLoc}`, {
      defaultHttpsIfMissingScheme: false,
    }).href;
  }

  const hashIdx = trimmedLoc.indexOf('#');
  const beforeHash = hashIdx === -1 ? trimmedLoc : trimmedLoc.slice(0, hashIdx);
  const relHash = hashIdx === -1 ? '' : trimmedLoc.slice(hashIdx);
  const queryIdx = beforeHash.indexOf('?');
  const relPath = queryIdx === -1 ? beforeHash : beforeHash.slice(0, queryIdx);
  const relSearch = queryIdx === -1 ? '' : beforeHash.slice(queryIdx);

  let mergedPath: string;
  if (relPath.startsWith('/')) {
    mergedPath = normalizeUrlPath(relPath);
  } else {
    const lastSlash = base.pathname.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? base.pathname.slice(0, lastSlash + 1) : '/';
    mergedPath = normalizeUrlPath(`${baseDir}${relPath}`);
  }

  return parseHttpUrl(`${base.origin}${mergedPath}${relSearch}${relHash}`, {
    defaultHttpsIfMissingScheme: false,
  }).href;
}

/**
 * Validates and normalizes a user-supplied Vikunja server URL:
 * - Defaults missing scheme to `https://`
 * - Rejects non-HTTP(S) schemes, embedded credentials (`user:pass@`), malformed hosts, and invalid IPv4/IPv6 literals
 * - Strips hash fragments (`/#/login`), query strings, and trailing `/login` or `/api/v1` suffixes
 * - Flags cleartext `http://` URLs via `isInsecureHttp`
 */
export function parseAndValidateServerUrl(rawUrl: string): ParsedServerUrl {
  const parsed = parseHttpUrl(rawUrl, { defaultHttpsIfMissingScheme: true });

  // Strip Vue hash router paths (e.g. `/#/login`), query strings, trailing slashes, and `/login` or `/api/v1`
  let pathname = (parsed.pathname || '').replace(/\/+$/, '');
  while (/\/(api\/v1\/login|api\/v1|login)$/i.test(pathname)) {
    pathname = pathname.replace(/\/(api\/v1\/login|api\/v1|login)$/i, '').replace(/\/+$/, '');
  }

  const serverUrl = `${parsed.origin}${pathname}`;
  const apiBaseUrl = `${serverUrl}/api/v1`;

  return {
    serverUrl,
    apiBaseUrl,
    isInsecureHttp: parsed.protocol === 'http:',
  };
}

/**
 * Detects whether an API error indicates Vikunja requires or rejected a TOTP 2FA passcode.
 * Vikunja returns code `1017` ("Invalid totp passcode.") or HTTP 412 when 2FA is enabled.
 */
export function isTotpRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as any;
  if (anyErr.data?.code === 1017) return true;
  if (anyErr.status === 412) return true;
  const msg = typeof anyErr.message === 'string' ? anyErr.message : '';
  return /\btotp\b|\b2fa\b|two[- ]factor|passcode|authenticator/i.test(msg);
}

const DEFAULT_PER_PAGE = 50;
const MAX_PAGINATION_PAGES = 100;
const MAX_REDIRECT_HOPS = 3;
/** Renew short-lived (10-minute) access JWTs proactively when <= 90s remain or already expired. */
export const PROACTIVE_REFRESH_WINDOW_MS = 90_000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Pure-JS RFC 4648 Base64 / Base64URL -> UTF-8 decoder.
 * Does NOT depend on `atob`, `Buffer`, or `TextDecoder` so Hermes on Android never throws.
 */
function decodeBase64UrlToUtf8(b64url: string): string | null {
  if (!b64url || typeof b64url !== 'string') return null;
  const normalized = b64url.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!normalized || normalized.length % 4 === 1) {
    return null;
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (let i = 0; i < normalized.length; i++) {
    const val = BASE64_ALPHABET.indexOf(normalized.charAt(i));
    if (val === -1) {
      return null;
    }
    buffer = (buffer << 6) | val;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0) {
      if (i >= bytes.length) return null;
      const b1 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0) {
      if (i + 1 >= bytes.length) return null;
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if ((b0 & 0xf8) === 0xf0) {
      if (i + 2 >= bytes.length) return null;
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const codePoint =
        (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) -
        0x10000;
      out += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    } else {
      return null;
    }
  }
  return out;
}

/**
 * Extracts the JWT `exp` claim in milliseconds since epoch (`exp * 1000`),
 * or returns `null` if the token is a Personal API Token (`tk_...`), opaque, or lacks `exp`.
 */
export function getJwtExpirationMs(token?: string | null): number | null {
  if (!token || typeof token !== 'string' || isPersonalApiToken(token)) {
    return null;
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const jsonStr = decodeBase64UrlToUtf8(parts[1]);
    if (!jsonStr) return null;
    const payload = JSON.parse(jsonStr);
    if (
      payload &&
      typeof payload === 'object' &&
      typeof payload.exp === 'number' &&
      Number.isFinite(payload.exp) &&
      payload.exp > 0
    ) {
      return payload.exp * 1000;
    }
  } catch (_) {
    return null;
  }
  return null;
}

/**
 * Extracts `vikunja_refresh_token` from `Response.headers`, supporting `getSetCookie()`,
 * comma/newline-folded `Set-Cookie` strings (including `Expires=Wed, ...` commas), and header maps.
 */
export function extractRefreshTokenFromHeaders(headers: any): string | null {
  if (!headers) return null;

  const rawHeaderValues: string[] = [];
  try {
    if (typeof headers.getSetCookie === 'function') {
      const list = headers.getSetCookie();
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (typeof entry === 'string' && entry) {
            rawHeaderValues.push(entry);
          }
        }
      }
    }
    if (typeof headers.get === 'function') {
      const single = headers.get('set-cookie') ?? headers.get('Set-Cookie');
      if (typeof single === 'string' && single) {
        rawHeaderValues.push(single);
      }
    } else if (typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'set-cookie' && headers[key]) {
          if (Array.isArray(headers[key])) {
            for (const v of headers[key]) {
              if (v) rawHeaderValues.push(String(v));
            }
          } else {
            rawHeaderValues.push(String(headers[key]));
          }
        }
      }
    }
  } catch (_) {
    return null;
  }

  let lastNonEmpty: string | null = null;
  const pattern = /(?:^|[,;\r\n\s])vikunja_refresh_token=([^;\r\n\s,]*)/gi;

  for (const raw of rawHeaderValues) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      const candidate = (match[1] || '').replace(/^"|"$/g, '').trim();
      if (candidate.length > 0) {
        lastNonEmpty = candidate;
      }
    }
  }

  return lastNonEmpty;
}

function isAuthCookieEndpoint(endpoint: string): boolean {
  return (
    endpoint === '/login' ||
    endpoint.startsWith('/login?') ||
    endpoint === '/user/token/refresh' ||
    endpoint.startsWith('/user/token/refresh?') ||
    endpoint === '/user/token' ||
    endpoint.startsWith('/user/token?') ||
    endpoint === '/user/logout' ||
    endpoint.startsWith('/user/logout?')
  );
}

function isRefreshCookieConsumerEndpoint(endpoint: string): boolean {
  return (
    endpoint === '/user/token/refresh' ||
    endpoint.startsWith('/user/token/refresh?') ||
    endpoint === '/user/logout' ||
    endpoint.startsWith('/user/logout?')
  );
}

function isRefreshCookieProducerEndpoint(endpoint: string): boolean {
  return (
    endpoint === '/login' ||
    endpoint.startsWith('/login?') ||
    endpoint === '/user/token/refresh' ||
    endpoint.startsWith('/user/token/refresh?')
  );
}

interface InternalRequestOptions extends RequestInit {
  _isRetry?: boolean;
  _skipAuthRefresh?: boolean;
  _omitAuthHeader?: boolean;
  _timeoutMsOverride?: number;
  _ignoreSessionSignal?: boolean;
}

interface ResponseWithMeta<T> {
  data: T;
  totalPages: number | null;
  paginationLimit: number | null;
}

export class VikunjaClient {
  private baseApiUrl: string;
  private baseOrigin: ParsedHttpUrl;
  private token: string | null = null;
  private refreshToken: string | null = null;
  private timeoutMs: number;
  private sessionSignal?: AbortSignal;
  public onUnauthorized?: () => void;
  public onTokenRefresh?: () => Promise<string | null>;
  public onRefreshTokenUpdated?: (refreshToken: string | null) => Promise<void> | void;
  public onTransientRefreshFailure?: () => void;
  private refreshPromise: Promise<string | null> | null = null;
  private lastRefreshOutcome: 'ok' | 'transient_error' | 'auth_error' = 'ok';
  private lastRefreshError: unknown = null;
  private failedProactiveRefreshForToken: string | null = null;
  private hasNotifiedUnauthorized = false;

  constructor(config: VikunjaClientConfig) {
    this.baseApiUrl = this.normalizeUrl(config.baseUrl);
    this.baseOrigin = parseHttpUrl(this.baseApiUrl, { defaultHttpsIfMissingScheme: false });
    if (config.token) {
      this.token = config.token;
    }
    if (config.refreshToken) {
      this.refreshToken = config.refreshToken;
    }
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.sessionSignal = config.sessionSignal;
    this.onUnauthorized = config.onUnauthorized;
    this.onTokenRefresh = config.onTokenRefresh;
    this.onRefreshTokenUpdated = config.onRefreshTokenUpdated;
    this.onTransientRefreshFailure = config.onTransientRefreshFailure;
  }

  private normalizeUrl(url: string): string {
    return parseAndValidateServerUrl(url).apiBaseUrl;
  }

  public getBaseApiUrl(): string {
    return this.baseApiUrl;
  }

  public setToken(token: string | null): void {
    this.token = token;
    this.hasNotifiedUnauthorized = false;
    this.failedProactiveRefreshForToken = null;
  }

  public getToken(): string | null {
    return this.token;
  }

  public setRefreshToken(refreshToken: string | null): void {
    this.refreshToken = refreshToken || null;
  }

  public getRefreshToken(): string | null {
    return this.refreshToken;
  }

  private classifyRefreshError(err: unknown): 'transient_error' | 'auth_error' {
    if (
      err instanceof VikunjaApiError &&
      (err.status === 400 || err.status === 401 || err.status === 403)
    ) {
      return 'auth_error';
    }
    const status = (err as any)?.status ?? (err as any)?.response?.status;
    if (status === 400 || status === 401 || status === 403) {
      return 'auth_error';
    }
    return 'transient_error';
  }

  private runSingleflightRefresh(): Promise<string | null> {
    if (!this.onTokenRefresh || isPersonalApiToken(this.token)) {
      return Promise.resolve(null);
    }
    if (!this.refreshPromise) {
      this.lastRefreshOutcome = 'ok';
      this.lastRefreshError = null;
      this.refreshPromise = Promise.resolve()
        .then(() => this.onTokenRefresh!())
        .then((newToken) => {
          if (newToken) {
            this.lastRefreshOutcome = 'ok';
            this.lastRefreshError = null;
            return newToken;
          }
          if (this.lastRefreshOutcome === 'ok') {
            this.lastRefreshOutcome = 'auth_error';
          }
          return null;
        })
        .catch((err) => {
          this.lastRefreshOutcome = this.classifyRefreshError(err);
          this.lastRefreshError = err;
          return null;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  private isSafeSameOriginTarget(targetUrlStr: string): boolean {
    try {
      const target = parseHttpUrl(targetUrlStr, { defaultHttpsIfMissingScheme: false });
      if (target.host !== this.baseOrigin.host) {
        return false;
      }
      // Never allow protocol downgrade from https: to http:
      if (this.baseOrigin.protocol === 'https:' && target.protocol !== 'https:') {
        return false;
      }
      return target.protocol === 'https:' || target.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  private async requestWithMeta<T>(
    endpoint: string,
    options: InternalRequestOptions = {}
  ): Promise<ResponseWithMeta<T>> {
    const isAuthEndpoint = isAuthCookieEndpoint(endpoint);
    const effectiveTimeoutMs = options._timeoutMsOverride ?? this.timeoutMs;

    const callerSignals: AbortSignal[] = [];
    if (options.signal) callerSignals.push(options.signal);
    if (
      !options._ignoreSessionSignal &&
      this.sessionSignal &&
      this.sessionSignal !== options.signal
    ) {
      callerSignals.push(this.sessionSignal);
    }

    if (callerSignals.some((s) => s.aborted)) {
      const abortErr = new Error('Request aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    // Proactive pre-expiry JWT renewal: renew before sending if <= 90s remain or already expired.
    // Concurrent callers share a single `this.refreshPromise` so rotating refresh tokens are never reused.
    if (
      !options._isRetry &&
      !options._skipAuthRefresh &&
      !options._omitAuthHeader &&
      !isAuthEndpoint &&
      this.token &&
      !isPersonalApiToken(this.token) &&
      this.onTokenRefresh
    ) {
      const expMs = getJwtExpirationMs(this.token);
      const now = Date.now();
      const isExpired = expMs !== null && expMs <= now;
      const isNearExpiry = expMs !== null && expMs - now <= PROACTIVE_REFRESH_WINDOW_MS;

      if (
        this.refreshPromise ||
        isExpired ||
        (isNearExpiry && this.failedProactiveRefreshForToken !== this.token)
      ) {
        const tokenBeforeRefresh = this.token;
        const refreshedToken = await this.runSingleflightRefresh();

        if (callerSignals.some((s) => s.aborted)) {
          const abortErr = new Error('Request aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        if (refreshedToken) {
          this.setToken(refreshedToken);
        } else {
          const expAfterMs = getJwtExpirationMs(this.token);
          const stillExpired = expAfterMs !== null && expAfterMs <= Date.now();
          if (stillExpired) {
            if (this.lastRefreshOutcome === 'transient_error') {
              this.onTransientRefreshFailure?.();
              throw (
                (this.lastRefreshError instanceof Error ? this.lastRefreshError : null) ??
                new Error('Network request failed while renewing session')
              );
            }
            this.failedProactiveRefreshForToken = tokenBeforeRefresh;
            if (this.onUnauthorized && !this.hasNotifiedUnauthorized) {
              this.hasNotifiedUnauthorized = true;
              this.onUnauthorized();
            }
            throw (
              (this.lastRefreshError instanceof VikunjaApiError
                ? this.lastRefreshError
                : null) ?? new VikunjaApiError(401, 'Session expired')
            );
          } else if (this.lastRefreshOutcome === 'auth_error') {
            this.failedProactiveRefreshForToken = tokenBeforeRefresh;
          }
        }
      }
    }

    const initialUrl = `${this.baseApiUrl}${endpoint}`;
    const hasBody = options.body !== undefined && options.body !== null;

    // Identify Guanaco cleanly in Vikunja's active sessions tab on native OSes while omitting
    // custom User-Agent on web browsers so strict CORS preflights never reject requests.
    const nativePlatformLabel =
      Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS;
    const defaultUserAgent =
      Platform.OS && Platform.OS !== 'web'
        ? `${APP_NAME}/${APP_VERSION} (${nativePlatformLabel})`
        : undefined;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(defaultUserAgent ? { 'User-Agent': defaultUserAgent } : {}),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const requestToken = this.token;
    if (requestToken && !options._omitAuthHeader) {
      headers['Authorization'] = `Bearer ${requestToken}`;
    }

    if (Platform.OS === 'web') {
      // Forbidden request header in browsers; Web relies strictly on `credentials: 'include'`
      delete headers['Cookie'];
      delete headers['cookie'];
    } else if (
      isRefreshCookieConsumerEndpoint(endpoint) &&
      this.refreshToken &&
      !headers['Cookie'] &&
      !headers['cookie']
    ) {
      headers['Cookie'] = `vikunja_refresh_token=${this.refreshToken}`;
    }

    const controller = new AbortController();
    let isTimedOut = false;
    let isCallerAborted = false;

    const onCallerAbort = () => {
      isCallerAborted = true;
      controller.abort();
    };

    for (const sig of callerSignals) {
      if (sig.aborted) {
        isCallerAborted = true;
        controller.abort();
        break;
      }
      sig.addEventListener('abort', onCallerAbort);
    }

    const timer = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, effectiveTimeoutMs);

    try {
      if (isCallerAborted) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const {
        _isRetry,
        _skipAuthRefresh,
        _omitAuthHeader,
        _timeoutMsOverride,
        _ignoreSessionSignal,
        signal: _ignoredSignal,
        ...fetchInit
      } = options;

      const resolvedCredentials = isAuthEndpoint
        ? fetchInit.credentials ?? 'include'
        : fetchInit.credentials;

      let currentUrl = initialUrl;
      let currentMethod = fetchInit.method || 'GET';
      let currentBody = fetchInit.body;
      let response: Response | undefined;

      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const hopHeaders = { ...headers };
        if (currentBody === undefined || currentBody === null) {
          delete hopHeaders['Content-Type'];
        }

        response = await fetch(currentUrl, {
          ...fetchInit,
          ...(resolvedCredentials !== undefined ? { credentials: resolvedCredentials } : {}),
          method: currentMethod,
          body: currentBody,
          headers: hopHeaders,
          redirect: Platform.OS === 'web' ? 'follow' : 'manual',
          signal: controller.signal,
        });

        if (!response) {
          throw new Error('No response received');
        }

        if ((response as any).type === 'opaqueredirect') {
          throw new VikunjaApiError(
            0,
            'Blocked opaque redirect from server to protect authentication credentials'
          );
        }

        // Verify final response URL if populated by underlying XHR/fetch runtime
        if (response.url && !this.isSafeSameOriginTarget(response.url)) {
          throw new VikunjaApiError(
            0,
            'Blocked cross-origin or insecure redirect to protect authentication credentials'
          );
        }

        // Handle 3xx redirects manually so Authorization never leaks cross-origin or over downgraded HTTP
        if (
          response.status === 301 ||
          response.status === 302 ||
          response.status === 303 ||
          response.status === 307 ||
          response.status === 308
        ) {
          const location = response.headers?.get?.('location');
          if (!location) {
            break;
          }
          let resolvedRedirect: string;
          try {
            resolvedRedirect = resolveHttpRedirectUrl(location, currentUrl);
          } catch (_) {
            throw new VikunjaApiError(
              response.status,
              'Blocked cross-origin or protocol-downgrade redirect to protect authentication credentials'
            );
          }
          if (!this.isSafeSameOriginTarget(resolvedRedirect)) {
            throw new VikunjaApiError(
              response.status,
              'Blocked cross-origin or protocol-downgrade redirect to protect authentication credentials'
            );
          }
          if (hop === MAX_REDIRECT_HOPS) {
            throw new VikunjaApiError(response.status, 'Too many redirects');
          }
          currentUrl = resolvedRedirect;
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
          ) {
            currentMethod = 'GET';
            currentBody = undefined;
          }
          continue;
        }

        break;
      }

      if (!response) {
        throw new Error('No response received');
      }

      // Immediately capture & persist rotated `vikunja_refresh_token` BEFORE parsing JSON or resolving refreshPromise!
      if (response.ok && Platform.OS !== 'web' && isRefreshCookieProducerEndpoint(endpoint)) {
        const rotatedRefreshToken = extractRefreshTokenFromHeaders(response.headers);
        if (rotatedRefreshToken) {
          this.refreshToken = rotatedRefreshToken;
          await this.onRefreshTokenUpdated?.(rotatedRefreshToken);
        }
      }

      let data: any = null;
      const hasHeadersApi = Boolean(response.headers && typeof response.headers.get === 'function');
      const contentType = hasHeadersApi
        ? (response.headers.get('content-type') || '').toLowerCase()
        : '';

      let totalPages: number | null = null;
      let paginationLimit: number | null = null;
      if (hasHeadersApi) {
        const rawTotalPages = response.headers.get('x-pagination-total-pages');
        if (rawTotalPages) {
          const parsedPages = parseInt(rawTotalPages, 10);
          if (!isNaN(parsedPages) && parsedPages >= 0) {
            totalPages = parsedPages;
          }
        }
        const rawLimit = response.headers.get('x-pagination-limit');
        if (rawLimit) {
          const parsedLimit = parseInt(rawLimit, 10);
          if (!isNaN(parsedLimit) && parsedLimit > 0) {
            paginationLimit = parsedLimit;
          }
        }
      }

      if (response.status !== 204 && response.status !== 205) {
        const shouldParseJson = hasHeadersApi
          ? contentType.includes('application/json') ||
            contentType.includes('+json') ||
            contentType === ''
          : typeof response.json === 'function';

        if (shouldParseJson && typeof response.json === 'function') {
          try {
            data = await response.json();
          } catch (_) {
            data = null;
          }
        }
      }

      if (!response.ok) {
        if (
          response.status === 401 &&
          !options._isRetry &&
          !options._skipAuthRefresh &&
          !isAuthEndpoint
        ) {
          // 1. If a sibling request already refreshed the token while we were in-flight, retry with the updated token
          if (requestToken && this.token && this.token !== requestToken) {
            return await this.requestWithMeta<T>(endpoint, {
              ...options,
              _isRetry: true,
            });
          }

          // 2. Attempt singleflight JWT renewal (never for Personal API Tokens `tk_...`)
          if (this.onTokenRefresh && !isPersonalApiToken(this.token)) {
            const newToken = await this.runSingleflightRefresh();
            if (newToken) {
              this.setToken(newToken);
              return await this.requestWithMeta<T>(endpoint, {
                ...options,
                _isRetry: true,
              });
            }
            if (this.lastRefreshOutcome === 'transient_error') {
              this.onTransientRefreshFailure?.();
              throw (
                (this.lastRefreshError instanceof Error ? this.lastRefreshError : null) ??
                new Error('Network request failed while renewing session')
              );
            }
          }
        }

        if (
          response.status === 401 &&
          !options._skipAuthRefresh &&
          !isAuthEndpoint &&
          this.onUnauthorized &&
          !this.hasNotifiedUnauthorized
        ) {
          this.hasNotifiedUnauthorized = true;
          this.onUnauthorized();
        }

        const errorMsg = data?.message || response.statusText || 'API request failed';
        const isProxy403 =
          response.status === 403 &&
          !(data && typeof data === 'object' && typeof data.code === 'number');
        throw new VikunjaApiError(response.status, errorMsg, data, isProxy403 || undefined);
      }

      return { data: data as T, totalPages, paginationLimit };
    } catch (err: any) {
      if (isCallerAborted && !isTimedOut) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      if (isTimedOut || err?.name === 'AbortError') {
        const timeoutErr = new Error(`Request timed out after ${effectiveTimeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      for (const sig of callerSignals) {
        sig.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  private async request<T>(
    endpoint: string,
    options: InternalRequestOptions = {}
  ): Promise<T> {
    const { data } = await this.requestWithMeta<T>(endpoint, options);
    return data;
  }

  // --- Auth Endpoints ---
  public async login(
    username: string,
    password: string,
    longTokenOrOptions: boolean | { longToken?: boolean; totpPasscode?: string } = true,
    totpPasscode?: string
  ): Promise<AuthTokens> {
    const longToken =
      typeof longTokenOrOptions === 'object'
        ? longTokenOrOptions.longToken ?? true
        : longTokenOrOptions;
    const resolvedTotp =
      typeof longTokenOrOptions === 'object'
        ? longTokenOrOptions.totpPasscode ?? totpPasscode
        : totpPasscode;

    const payload: Record<string, any> = {
      username,
      password,
      long_token: longToken,
    };
    if (resolvedTotp && resolvedTotp.trim()) {
      payload.totp_passcode = resolvedTotp.trim();
    }

    const res = await this.request<AuthTokens>('/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      credentials: 'include',
      _skipAuthRefresh: true,
      _omitAuthHeader: true,
    });
    if (res?.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async renewToken(): Promise<AuthTokens> {
    if (isPersonalApiToken(this.token)) {
      this.lastRefreshOutcome = 'auth_error';
      throw new VikunjaApiError(400, 'Personal API tokens do not support JWT renewal');
    }

    try {
      const res = await this.request<AuthTokens>('/user/token/refresh', {
        method: 'POST',
        credentials: 'include',
        _skipAuthRefresh: true,
        _omitAuthHeader: true,
      });
      if (res?.token) {
        this.setToken(res.token);
      }
      this.lastRefreshOutcome = 'ok';
      this.lastRefreshError = null;
      return res;
    } catch (err: any) {
      // Pre-2.0 Vikunja fallback: ONLY when `/user/token/refresh` is unsupported (404 or 405),
      // fall back to legacy `POST /user/token` using `Authorization: Bearer <token>`.
      if (err instanceof VikunjaApiError && (err.status === 404 || err.status === 405)) {
        try {
          const legacyRes = await this.request<AuthTokens>('/user/token', {
            method: 'POST',
            credentials: 'include',
            _skipAuthRefresh: true,
          });
          if (legacyRes?.token) {
            this.setToken(legacyRes.token);
          }
          this.lastRefreshOutcome = 'ok';
          this.lastRefreshError = null;
          return legacyRes;
        } catch (legacyErr: any) {
          this.lastRefreshOutcome = this.classifyRefreshError(legacyErr);
          this.lastRefreshError = legacyErr;
          throw legacyErr;
        }
      }
      this.lastRefreshOutcome = this.classifyRefreshError(err);
      this.lastRefreshError = err;
      throw err;
    }
  }

  /**
   * Best-effort server session revocation (`POST /user/logout`) with a short 4s timeout.
   * Never throws so offline or legacy servers cannot block local sign-out.
   */
  public async logoutServer(): Promise<void> {
    const expMs = getJwtExpirationMs(this.token);
    const tokenExpired = expMs !== null && expMs <= Date.now();
    const omitAuth = !this.token || isPersonalApiToken(this.token) || tokenExpired;

    try {
      await this.request<any>('/user/logout', {
        method: 'POST',
        credentials: 'include',
        _skipAuthRefresh: true,
        _omitAuthHeader: omitAuth,
        _timeoutMsOverride: 4000,
        _ignoreSessionSignal: true,
      });
    } catch (_) {
      // Best-effort server logout
    } finally {
      this.refreshToken = null;
    }
  }

  public async getCurrentUser(): Promise<User> {
    return this.request<User>('/user', { method: 'GET' });
  }

  private normalizeListResponse<T>(res: any): T[] {
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.items)) return res.items;
    if (Array.isArray(res?.data)) return res.data;
    return [];
  }

  private extractEnvelopeTotalPages(res: any): number | null {
    if (res && typeof res === 'object' && !Array.isArray(res)) {
      const tp = Number(res.total_pages ?? res.totalPages);
      if (Number.isInteger(tp) && tp >= 0) {
        return tp;
      }
    }
    return null;
  }

  private appendDeduplicatedPageItems<T>(
    allItems: T[],
    indexById: Map<number | string, number>,
    pageItems: T[]
  ): number {
    let newUniqueCount = 0;
    for (const item of pageItems) {
      const itemId =
        item && typeof item === 'object' && 'id' in (item as any)
          ? (item as any).id
          : undefined;
      if (
        (typeof itemId === 'number' && Number.isFinite(itemId) && itemId !== 0) ||
        (typeof itemId === 'string' && itemId !== '')
      ) {
        const existingIdx = indexById.get(itemId);
        if (existingIdx !== undefined) {
          allItems[existingIdx] = item;
        } else {
          indexById.set(itemId, allItems.length);
          allItems.push(item);
          newUniqueCount += 1;
        }
      } else {
        allItems.push(item);
        newUniqueCount += 1;
      }
    }
    return newUniqueCount;
  }

  /**
   * Fetches either a single explicit page or automatically paginates through all pages.
   * Rethrows any network, timeout, auth, or server error on ANY page so partial results
   * never overwrite cached local state.
   */
  private async fetchPaginatedList<T>(
    baseEndpoint: string,
    params?: {
      page?: number;
      per_page?: number;
      extraParams?: Record<string, string | string[] | undefined>;
      signal?: AbortSignal;
    }
  ): Promise<T[]> {
    const buildQuery = (page?: number, perPage?: number): string => {
      const qParams = new URLSearchParams();
      if (params?.extraParams) {
        for (const [k, v] of Object.entries(params.extraParams)) {
          if (Array.isArray(v)) {
            v.forEach((entry) => qParams.append(k, entry));
          } else if (v !== undefined) {
            qParams.set(k, v);
          }
        }
      }
      if (page !== undefined) qParams.set('page', page.toString());
      if (perPage !== undefined) qParams.set('per_page', perPage.toString());
      const qs = qParams.toString();
      return qs ? `?${qs}` : '';
    };

    if (params?.page !== undefined) {
      const res = await this.request<any>(
        `${baseEndpoint}${buildQuery(params.page, params.per_page)}`,
        { method: 'GET', signal: params.signal }
      );
      const singlePageItems = this.normalizeListResponse<T>(res);
      const deduped: T[] = [];
      this.appendDeduplicatedPageItems(deduped, new Map(), singlePageItems);
      return deduped;
    }

    const perPage = params?.per_page ?? DEFAULT_PER_PAGE;
    const allItems: T[] = [];
    const indexById = new Map<number | string, number>();
    let page = 1;

    while (page <= MAX_PAGINATION_PAGES) {
      const query = buildQuery(page, perPage);

      const {
        data: res,
        totalPages: headerTotalPages,
        paginationLimit,
      } = await this.requestWithMeta<any>(`${baseEndpoint}${query}`, {
        method: 'GET',
        signal: params?.signal,
      });

      const items = this.normalizeListResponse<T>(res);
      if (items.length === 0) {
        break;
      }

      const newUniqueCount = this.appendDeduplicatedPageItems(allItems, indexById, items);

      const knownTotalPages = headerTotalPages ?? this.extractEnvelopeTotalPages(res);
      const effectivePageLimit = paginationLimit ?? perPage;
      if (page > 1 && knownTotalPages === null && newUniqueCount === 0) {
        break;
      }
      if (knownTotalPages !== null) {
        if (page >= knownTotalPages) {
          break;
        }
        page += 1;
      } else if (items.length < effectivePageLimit) {
        break;
      } else {
        page += 1;
      }
    }

    return allItems;
  }

  // --- Projects Endpoints ---
  public async getProjects(params?: {
    is_archived?: boolean;
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Project[]> {
    return this.fetchPaginatedList<Project>('/projects', {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
      extraParams: params?.is_archived ? { is_archived: 'true' } : undefined,
    });
  }

  public async getProject(projectId: number): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`, { method: 'GET' });
  }

  public async createProject(data: CreateProjectInput): Promise<Project> {
    return this.request<Project>('/projects', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async updateProject(projectId: number, data: UpdateProjectInput): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async deleteProject(projectId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  public async duplicateProject(projectId: number): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}/duplicate`, {
      method: 'PUT',
    });
  }

  public async getProjectViews(projectId: number): Promise<ProjectView[]> {
    const res = await this.request<any>(`/projects/${projectId}/views`, { method: 'GET' });
    return this.normalizeListResponse<ProjectView>(res);
  }

  // --- Project Sharing (Users) ---
  public async getProjectUsers(
    projectId: number,
    params?: { page?: number; per_page?: number; signal?: AbortSignal }
  ): Promise<ProjectUserShare[]> {
    return this.fetchPaginatedList<ProjectUserShare>(`/projects/${projectId}/users`, {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
  }

  public async addProjectUser(
    projectId: number,
    userIdOrInput: number | { user_id?: number; username?: string; permission?: Permission },
    permission?: Permission
  ): Promise<any> {
    if (typeof userIdOrInput === 'object') {
      let resolvedUserId = userIdOrInput.user_id;
      if (!resolvedUserId && userIdOrInput.username) {
        try {
          const users = await this.searchUsers(userIdOrInput.username);
          const found = users.find(
            (u) => u.username.toLowerCase() === userIdOrInput.username?.toLowerCase()
          );
          if (found) resolvedUserId = found.id;
        } catch (_) {}
      }
      const perm = userIdOrInput.permission ?? permission ?? 1;
      return this.request<any>(`/projects/${projectId}/users`, {
        method: 'PUT',
        body: JSON.stringify({
          user_id: resolvedUserId,
          username: userIdOrInput.username,
          permission: perm,
        }),
      });
    }

    return this.request<any>(`/projects/${projectId}/users`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: userIdOrInput, permission: permission ?? 1 }),
    });
  }

  public async updateProjectUser(
    projectId: number,
    userId: number,
    permission: Permission
  ): Promise<any> {
    return this.request<any>(`/projects/${projectId}/users/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ permission }),
    });
  }

  public async removeProjectUser(projectId: number, userId: number): Promise<any> {
    return this.request<any>(`/projects/${projectId}/users/${userId}`, {
      method: 'DELETE',
    });
  }

  // --- Project Sharing (Teams) ---
  public async getTeams(params?: {
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Team[]> {
    return this.fetchPaginatedList<Team>('/teams', {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
  }

  public async getProjectTeams(projectId: number): Promise<ProjectTeamShare[]> {
    const res = await this.request<any>(`/projects/${projectId}/teams`, { method: 'GET' });
    return this.normalizeListResponse<ProjectTeamShare>(res);
  }

  public async addProjectTeam(
    projectId: number,
    teamIdOrInput: number | { team_id: number; permission?: Permission },
    permission?: Permission
  ): Promise<any> {
    const teamId = typeof teamIdOrInput === 'object' ? teamIdOrInput.team_id : teamIdOrInput;
    const perm =
      typeof teamIdOrInput === 'object' ? teamIdOrInput.permission ?? 0 : permission ?? 0;
    return this.request<any>(`/projects/${projectId}/teams`, {
      method: 'PUT',
      body: JSON.stringify({ team_id: teamId, permission: perm }),
    });
  }

  public async updateProjectTeam(
    projectId: number,
    teamId: number,
    permission: Permission
  ): Promise<any> {
    return this.request<any>(`/projects/${projectId}/teams/${teamId}`, {
      method: 'POST',
      body: JSON.stringify({ permission }),
    });
  }

  public async removeProjectTeam(projectId: number, teamId: number): Promise<any> {
    return this.request<any>(`/projects/${projectId}/teams/${teamId}`, {
      method: 'DELETE',
    });
  }

  // --- Tasks Endpoints ---
  public async getTasks(
    projectId: number,
    params?: { page?: number; per_page?: number; filter_by?: string[]; signal?: AbortSignal }
  ): Promise<Task[]> {
    return this.fetchPaginatedList<Task>(`/projects/${projectId}/tasks`, {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
      extraParams: params?.filter_by?.length ? { filter_by: params.filter_by } : undefined,
    });
  }

  public async getAllTasks(params?: {
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Task[]> {
    const fetchTasksEndpoint = async (
      query: string,
      preferredEndpoint: '/tasks' | '/tasks/all'
    ): Promise<{ res: ResponseWithMeta<any>; resolvedEndpoint: '/tasks' | '/tasks/all' }> => {
      if (preferredEndpoint === '/tasks/all') {
        const res = await this.requestWithMeta<any>(`/tasks/all${query}`, {
          method: 'GET',
          signal: params?.signal,
        });
        return { res, resolvedEndpoint: '/tasks/all' };
      }

      try {
        const res = await this.requestWithMeta<any>(`/tasks${query}`, {
          method: 'GET',
          signal: params?.signal,
        });
        return { res, resolvedEndpoint: '/tasks' };
      } catch (err: any) {
        // ONLY fall back to legacy `/tasks/all` on 404 or 405; rethrow network/timeout/401/5xx!
        if (err instanceof VikunjaApiError && (err.status === 404 || err.status === 405)) {
          const res = await this.requestWithMeta<any>(`/tasks/all${query}`, {
            method: 'GET',
            signal: params?.signal,
          });
          return { res, resolvedEndpoint: '/tasks/all' };
        }
        throw err;
      }
    };

    if (params?.page !== undefined) {
      const qParams = new URLSearchParams();
      qParams.set('page', params.page.toString());
      if (params.per_page !== undefined) qParams.set('per_page', params.per_page.toString());
      const query = `?${qParams.toString()}`;
      const { res } = await fetchTasksEndpoint(query, '/tasks');
      const singlePageTasks = this.normalizeListResponse<Task>(res.data);
      const deduped: Task[] = [];
      this.appendDeduplicatedPageItems(deduped, new Map(), singlePageTasks);
      return deduped;
    }

    const perPage = params?.per_page ?? DEFAULT_PER_PAGE;
    let page = 1;
    let endpointToUse: '/tasks' | '/tasks/all' = '/tasks';
    const allTasks: Task[] = [];
    const indexById = new Map<number | string, number>();

    while (page <= MAX_PAGINATION_PAGES) {
      const query = `?page=${page}&per_page=${perPage}`;
      const { res, resolvedEndpoint } = await fetchTasksEndpoint(query, endpointToUse);
      endpointToUse = resolvedEndpoint;

      const items = this.normalizeListResponse<Task>(res.data);
      if (items.length === 0) {
        break;
      }

      const newUniqueCount = this.appendDeduplicatedPageItems(allTasks, indexById, items);

      const knownTotalPages = res.totalPages ?? this.extractEnvelopeTotalPages(res.data);
      const effectivePageLimit = res.paginationLimit ?? perPage;
      if (page > 1 && knownTotalPages === null && newUniqueCount === 0) {
        break;
      }
      if (knownTotalPages !== null) {
        if (page >= knownTotalPages) {
          break;
        }
        page += 1;
      } else if (items.length < effectivePageLimit) {
        break;
      } else {
        page += 1;
      }
    }

    return allTasks;
  }

  private sanitizePayloadReminders(payload: Record<string, any>, isCreate: boolean): void {
    if (!Array.isArray(payload.reminders)) return;
    payload.reminders = payload.reminders
      .map((r: any) => {
        if (!r || typeof r !== 'object') return null;
        const relTo =
          r.relative_to === 'due_date' ||
          r.relative_to === 'start_date' ||
          r.relative_to === 'end_date'
            ? r.relative_to
            : '';
        if (relTo) {
          const val = payload[relTo];
          const anchorMissing = isCreate
            ? !val || isZeroDate(val)
            : val === null || val === '' || isZeroDate(val);
          if (anchorMissing) {
            return null;
          }
        }
        return r;
      })
      .filter(Boolean);
    if (isCreate && payload.reminders.length === 0) {
      delete payload.reminders;
    }
  }

  public async createTask(projectId: number, data: CreateTaskInput): Promise<Task> {
    const payload: any = { ...data };
    delete payload.related_tasks;
    if (payload.color !== undefined && payload.hex_color === undefined) {
      payload.hex_color = payload.color;
    }
    this.sanitizePayloadReminders(payload, true);
    if (Array.isArray(payload.labels)) {
      payload.labels = payload.labels.filter((l: Label) => l && l.id > 0);
      if (payload.labels.length === 0) delete payload.labels;
    }
    if (Array.isArray(payload.assignees)) {
      payload.assignees = payload.assignees.filter((u: User) => u && u.id > 0);
      if (payload.assignees.length === 0) delete payload.assignees;
    }
    return this.request<Task>(`/projects/${projectId}/tasks`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  public async getTask(taskId: number): Promise<Task> {
    return this.request<Task>(`/tasks/${taskId}`, { method: 'GET' });
  }

  public async updateTask(taskId: number, data: UpdateTaskInput): Promise<Task> {
    const payload: any = { ...data };
    delete payload.related_tasks;
    if (typeof payload.id === 'number' && payload.id < 0) {
      delete payload.id;
    }
    if (payload.color !== undefined && payload.hex_color === undefined) {
      payload.hex_color = payload.color;
    }
    this.sanitizePayloadReminders(payload, false);
    if (Array.isArray(payload.labels)) {
      payload.labels = payload.labels.filter((l: Label) => l && l.id > 0);
    }
    if (Array.isArray(payload.assignees)) {
      payload.assignees = payload.assignees.filter((u: User) => u && u.id > 0);
    }
    return this.request<Task>(`/tasks/${taskId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Fetches the authoritative task via `GET /tasks/:id` (rethrowing on failure so an empty `{}`
   * payload NEVER wipes server fields), merges `patch`, sends `POST /tasks/:id`, and preserves
   * non-null relational slices (`labels`, `assignees`, `reminders`, `related_tasks`) omitted in POST response.
   */
  public async patchTask(
    taskId: number,
    patch: UpdateTaskInput,
    fallbackSnapshot?: Partial<Task>
  ): Promise<Task> {
    const fresh = await this.getTask(taskId);
    const hasValidFresh = Boolean(
      fresh &&
        typeof fresh === 'object' &&
        typeof fresh.id === 'number' &&
        typeof fresh.title === 'string' &&
        fresh.title.length > 0
    );
    const baseSource = hasValidFresh ? fresh : fallbackSnapshot;
    const merged: UpdateTaskInput = {
      ...(baseSource ? (baseSource as UpdateTaskInput) : {}),
      ...patch,
    };
    const updated = await this.updateTask(taskId, merged);
    if (!updated || typeof updated !== 'object') {
      return updated;
    }

    const result: Task = { ...updated };
    const sliceSource = hasValidFresh ? fresh : fallbackSnapshot;
    if (sliceSource && typeof sliceSource === 'object') {
      if (
        (result.labels === null || result.labels === undefined) &&
        patch.labels === undefined &&
        Array.isArray(sliceSource.labels)
      ) {
        result.labels = sliceSource.labels;
      }
      if (
        (result.assignees === null || result.assignees === undefined) &&
        patch.assignees === undefined &&
        Array.isArray(sliceSource.assignees)
      ) {
        result.assignees = sliceSource.assignees;
      }
      if (
        (result.reminders === null || result.reminders === undefined) &&
        patch.reminders === undefined &&
        Array.isArray(sliceSource.reminders)
      ) {
        result.reminders = sliceSource.reminders;
      }
      if (
        (result.related_tasks === null || result.related_tasks === undefined) &&
        sliceSource.related_tasks &&
        typeof sliceSource.related_tasks === 'object'
      ) {
        result.related_tasks = sliceSource.related_tasks;
      }
    }

    return result;
  }

  public async toggleTaskDone(
    taskId: number,
    done: boolean,
    taskSnapshot?: Partial<Task>
  ): Promise<Task> {
    return this.patchTask(taskId, { done }, taskSnapshot);
  }

  public async moveTask(
    taskId: number,
    targetProjectId: number,
    taskSnapshot?: Partial<Task>
  ): Promise<Task> {
    return this.patchTask(taskId, { project_id: targetProjectId }, taskSnapshot);
  }

  public async setTaskPosition(
    taskId: number,
    projectViewId: number,
    position: number
  ): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/position`, {
      method: 'POST',
      body: JSON.stringify({
        project_view_id: projectViewId,
        position,
      }),
    });
  }

  public async reorderTask(
    taskId: number,
    position: number,
    projectViewId?: number,
    taskSnapshot?: Partial<Task>
  ): Promise<any> {
    let resolvedViewId = projectViewId && projectViewId > 0 ? projectViewId : undefined;

    if (!resolvedViewId && taskSnapshot?.project_id && taskSnapshot.project_id > 0) {
      try {
        const views = await this.getProjectViews(taskSnapshot.project_id);
        const listView = views.find((v) => v.view_kind === 'list') || views[0];
        if (listView?.id && listView.id > 0) {
          resolvedViewId = listView.id;
        }
      } catch (_) {
        // Proceed to snapshot-backed fallback if views cannot be resolved
      }
    }

    if (resolvedViewId && resolvedViewId > 0) {
      try {
        return await this.setTaskPosition(taskId, resolvedViewId, position);
      } catch (err: any) {
        // Only fall back to updateTask when the dedicated position endpoint is unsupported (404/405)
        if (!(err instanceof VikunjaApiError && (err.status === 404 || err.status === 405))) {
          throw err;
        }
      }
    }

    // Fall back to fetch-then-merge `patchTask` so stale local snapshots never wipe concurrent server edits
    return this.patchTask(taskId, { position }, taskSnapshot);
  }

  public async deleteTask(taskId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // --- Task Relations (Subtasks) & Saved Filter Tasks ---
  public async createTaskRelation(
    taskId: number,
    otherTaskId: number,
    relationKind: TaskRelationKind = 'subtask'
  ): Promise<TaskRelation> {
    return this.request<TaskRelation>(`/tasks/${taskId}/relations`, {
      method: 'PUT',
      body: JSON.stringify({
        task_id: taskId,
        other_task_id: otherTaskId,
        relation_kind: relationKind,
      }),
    });
  }

  public async deleteTaskRelation(
    taskId: number,
    relationKind: TaskRelationKind,
    otherTaskId: number
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/tasks/${taskId}/relations/${encodeURIComponent(relationKind)}/${otherTaskId}`,
      {
        method: 'DELETE',
      }
    );
  }

  public async getSavedFilterTasks(
    filterProject: Project,
    params?: { page?: number; per_page?: number; signal?: AbortSignal }
  ): Promise<Task[]> {
    const serverId = filterProject.server_project_id ?? filterProject.id;
    let views = filterProject.views;
    if ((!views || views.length === 0) && typeof this.getProjectViews === 'function') {
      try {
        views = await this.getProjectViews(serverId);
      } catch {
        views = undefined;
      }
    }

    const listViewId =
      views?.find((v) => v.view_kind === 'list')?.id || views?.[0]?.id;

    if (listViewId && listViewId > 0) {
      try {
        return await this.fetchPaginatedList<Task>(
          `/projects/${serverId}/views/${listViewId}/tasks`,
          {
            page: params?.page,
            per_page: params?.per_page,
            signal: params?.signal,
          }
        );
      } catch (err: any) {
        if (!(err instanceof VikunjaApiError && (err.status === 404 || err.status === 405))) {
          throw err;
        }
      }
    }

    return this.fetchPaginatedList<Task>(`/projects/${serverId}/tasks`, {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
  }

  // --- Labels Endpoints ---
  public async getLabels(params?: {
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Label[]> {
    return this.fetchPaginatedList<Label>('/labels', {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
  }

  public async createLabel(title: string, hex_color?: string): Promise<Label> {
    return this.request<Label>('/labels', {
      method: 'PUT',
      body: JSON.stringify({ title, hex_color }),
    });
  }

  public async addLabelToTask(taskId: number, labelId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ label_id: labelId }),
    });
  }

  public async removeLabelFromTask(taskId: number, labelId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/labels/${labelId}`, {
      method: 'DELETE',
    });
  }

  public async updateLabel(
    id: number,
    input: { title?: string; hex_color?: string; description?: string }
  ): Promise<Label> {
    return this.request<Label>(`/labels/${id}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async deleteLabel(id: number): Promise<any> {
    return this.request<any>(`/labels/${id}`, {
      method: 'DELETE',
    });
  }

  public async setTaskLabels(
    taskId: number,
    labels: Label[],
    previousLabels?: Label[]
  ): Promise<Label[]> {
    const nextLabels = Array.isArray(labels) ? labels : [];

    // 1. Determine currently attached labels to identify removals and skip already-attached labels
    let currentTaskLabels: Label[] = previousLabels || [];
    if (!previousLabels) {
      const currentTask = await this.getTask(taskId);
      currentTaskLabels = Array.isArray(currentTask?.labels) ? currentTask.labels : [];
    }

    const alreadyAttachedIds = new Set(
      currentTaskLabels.filter((l) => l.id > 0).map((l) => l.id)
    );
    const alreadyAttachedTitles = new Set(
      currentTaskLabels.map((l) => l.title.trim().toLowerCase())
    );

    // 2. Identify labels to remove
    const labelsToRemove = currentTaskLabels.filter((oldLabel) => {
      return !nextLabels.some((newLabel) => {
        if (newLabel.id > 0 && oldLabel.id > 0 && newLabel.id === oldLabel.id) {
          return true;
        }
        return newLabel.title.trim().toLowerCase() === oldLabel.title.trim().toLowerCase();
      });
    });

    // 3. Detach removed labels
    for (const rem of labelsToRemove) {
      if (rem.id > 0) {
        try {
          await this.removeLabelFromTask(taskId, rem.id);
        } catch (err: any) {
          if (err instanceof VikunjaApiError && err.status === 404) {
            // Label already detached or deleted on server
          } else {
            throw err;
          }
        }
      }
    }

    if (nextLabels.length === 0) {
      return [];
    }

    // 4. Fetch existing labels from server to reuse IDs and preserve hex_color
    let existingLabels: Label[] = [];
    const needsServerLookup = nextLabels.some(
      (l) => l.id <= 0 || !l.hex_color || !alreadyAttachedIds.has(l.id)
    );
    if (needsServerLookup) {
      try {
        existingLabels = await this.getLabels();
      } catch (err) {
        // Rethrow if any label lacks a positive server ID so SyncQueue retries instead of dropping it
        if (nextLabels.some((l) => l.id <= 0)) {
          throw err;
        }
        existingLabels = [];
      }
    }

    const resolvedLabels: Label[] = [];

    for (const l of nextLabels) {
      let finalLabel: Label | undefined;

      if (l.id > 0) {
        finalLabel =
          existingLabels.find((el) => el.id === l.id) ||
          currentTaskLabels.find((cl) => cl.id === l.id) ||
          l;
      } else {
        finalLabel = existingLabels.find(
          (el) => el.title.trim().toLowerCase() === l.title.trim().toLowerCase()
        );
      }

      // If label doesn't exist on server yet, create it
      if (!finalLabel) {
        try {
          finalLabel = await this.createLabel(l.title.trim(), l.hex_color);
          existingLabels.push(finalLabel);
        } catch (err: any) {
          if (err instanceof VikunjaApiError && (err.status === 400 || err.status === 409)) {
            const refreshed = await this.getLabels();
            existingLabels = refreshed;
            finalLabel = refreshed.find(
              (el) => el.title.trim().toLowerCase() === l.title.trim().toLowerCase()
            );
          }
          if (!finalLabel) {
            throw err;
          }
        }
      }

      const wasAlreadyAttached =
        (finalLabel.id > 0 && alreadyAttachedIds.has(finalLabel.id)) ||
        (finalLabel.id > 0 && alreadyAttachedTitles.has(finalLabel.title.trim().toLowerCase()));

      if (finalLabel.id > 0 && !wasAlreadyAttached) {
        try {
          await this.addLabelToTask(taskId, finalLabel.id);
          alreadyAttachedIds.add(finalLabel.id);
          alreadyAttachedTitles.add(finalLabel.title.trim().toLowerCase());
        } catch (err: any) {
          if (err instanceof VikunjaApiError && (err.status === 409 || err.status === 400)) {
            // Already attached
          } else {
            throw err;
          }
        }
      }

      resolvedLabels.push(finalLabel);
    }

    return resolvedLabels;
  }

  // --- Assignees Endpoints ---
  public async searchUsers(query: string): Promise<User[]> {
    const res = await this.request<any>(`/users/search?s=${encodeURIComponent(query)}`, {
      method: 'GET',
    });
    return this.normalizeListResponse<User>(res);
  }

  public async addAssigneeToTask(taskId: number, userId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/assignees`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  public async removeAssigneeFromTask(taskId: number, userId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/assignees/${userId}`, {
      method: 'DELETE',
    });
  }

  public async setTaskAssignees(
    taskId: number,
    nextAssignees: User[],
    previousAssignees?: User[]
  ): Promise<User[]> {
    let currentAssignees = previousAssignees;
    if (!currentAssignees) {
      const task = await this.getTask(taskId);
      currentAssignees = task?.assignees || [];
    }

    const prevIds = new Set(currentAssignees.filter((u) => u.id > 0).map((u) => u.id));
    const prevByUsername = new Map(
      currentAssignees.map((u) => [u.username.toLowerCase(), u])
    );
    const nextIds = new Set(nextAssignees.filter((u) => u.id > 0).map((u) => u.id));
    const nextUsernames = new Set(nextAssignees.map((u) => u.username.toLowerCase()));

    // 1. Remove assignees present in previous but not in next
    for (const prev of currentAssignees) {
      const kept =
        (prev.id > 0 && nextIds.has(prev.id)) ||
        nextUsernames.has(prev.username.toLowerCase());
      if (!kept && prev.id > 0) {
        try {
          await this.removeAssigneeFromTask(taskId, prev.id);
        } catch (err: any) {
          if (err instanceof VikunjaApiError && err.status === 404) {
            // Already removed
          } else {
            throw err;
          }
        }
      }
    }

    // 2. Add new assignees (skipping ones already assigned)
    const resolvedAssignees: User[] = [];
    for (const u of nextAssignees) {
      const prevMatch = prevByUsername.get(u.username.toLowerCase());
      const alreadyAssigned =
        (u.id > 0 && prevIds.has(u.id)) || Boolean(prevMatch && prevMatch.id > 0);

      if (alreadyAssigned) {
        resolvedAssignees.push(u.id > 0 ? u : prevMatch || u);
        continue;
      }

      let finalUser = u;
      if (finalUser.id <= 0) {
        const found = await this.searchUsers(u.username);
        const matched = found.find(
          (f) => f.username.toLowerCase() === u.username.toLowerCase()
        );
        if (matched) {
          finalUser = matched;
        }
      }

      if (finalUser.id > 0) {
        try {
          await this.addAssigneeToTask(taskId, finalUser.id);
          prevIds.add(finalUser.id);
        } catch (err: any) {
          if (err instanceof VikunjaApiError && (err.status === 409 || err.status === 400)) {
            // Already assigned
          } else {
            throw err;
          }
        }
      }
      resolvedAssignees.push(finalUser);
    }

    return resolvedAssignees;
  }
}
