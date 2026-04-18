/**
 * Input sanitization utilities.
 *
 * These helpers are intentionally unwired — they are NOT applied globally.
 * The canonical validation entry point is zod (via nestjs-zod) at the
 * controller boundary. Sanitization is a *defense-in-depth* layer that you
 * may opt into for fields whose shape is loose (e.g. free-text notes,
 * display names) or which are echoed back into other systems (Telegram
 * messages, logs, CSV exports) where control characters or unbounded
 * strings can cause trouble downstream.
 *
 * See ./README.md for guidance on where each helper is (and isn't)
 * appropriate.
 */

/** Default maximum length for loosely-typed free-text fields. */
export const DEFAULT_MAX_STRING_LENGTH = 10_000;

/** Default maximum length for a single "line" of input (name, title). */
export const DEFAULT_MAX_LINE_LENGTH = 256;

/**
 * Strip ASCII control characters (C0 range + DEL) except for the three
 * common whitespace characters we usually want to keep: tab, LF, CR.
 *
 * This also strips the C1 control range (U+0080..U+009F) which is rarely
 * legitimate in user input.
 */
export function stripControlChars(input: string): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0080-\u009F]/g, '');
}

/** Collapse runs of internal whitespace to a single space and trim ends. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Hard-clip a string to a maximum byte-agnostic length (codepoints). */
export function clampLength(input: string, max: number): string {
  if (input.length <= max) return input;
  return Array.from(input).slice(0, max).join('');
}

export interface SanitizeStringOptions {
  /** Max length after stripping. Defaults to DEFAULT_MAX_STRING_LENGTH. */
  maxLength?: number;
  /** Collapse internal whitespace. Default: false. */
  collapseWhitespace?: boolean;
  /** Trim leading/trailing whitespace. Default: true. */
  trim?: boolean;
}

/**
 * General-purpose text sanitizer. Strips control chars, optionally
 * normalizes whitespace, and clamps length.
 *
 * Intended for free-text fields (notes, descriptions). Do NOT apply to
 * fields that have a strict format (emails, tokens, IDs) — validate those
 * with zod instead.
 */
export function sanitizeString(input: string, options: SanitizeStringOptions = {}): string {
  const {
    maxLength = DEFAULT_MAX_STRING_LENGTH,
    collapseWhitespace: doCollapse = false,
    trim = true,
  } = options;

  let out = stripControlChars(input);
  if (doCollapse) out = collapseWhitespace(out);
  else if (trim) out = out.trim();
  return clampLength(out, maxLength);
}

/**
 * Sanitizer for a single-line field — names, titles, labels. Always
 * collapses whitespace and uses a tighter default length limit.
 */
export function sanitizeLine(input: string, maxLength: number = DEFAULT_MAX_LINE_LENGTH): string {
  return sanitizeString(input, { maxLength, collapseWhitespace: true });
}

/**
 * Sanitize every string value in a plain object (shallow). Non-string
 * values are passed through unchanged. Useful for cleaning a DTO *after*
 * zod has confirmed its shape.
 */
export function sanitizeObjectStrings<T extends Record<string, unknown>>(
  obj: T,
  options: SanitizeStringOptions = {},
): T {
  const result: Record<string, unknown> = { ...obj };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value, options);
    }
  }
  return result as T;
}
