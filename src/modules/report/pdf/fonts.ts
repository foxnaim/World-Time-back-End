import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import type PDFKit from 'pdfkit';

const logger = new Logger('ReportFonts');

/** Keys we register on every PDFDocument so call sites can stay font-agnostic. */
export const FONTS = {
  heading: 'Heading',
  headingMedium: 'HeadingMedium',
  body: 'Body',
} as const;

export type FontKey = (typeof FONTS)[keyof typeof FONTS];

/**
 * Fallbacks used when a TTF isn't available on disk. PDFKit ships the 14 PDF
 * standard fonts built-in, so Helvetica is always safe.
 */
const HELVETICA_FALLBACKS: Record<FontKey, string> = {
  [FONTS.heading]: 'Helvetica-Bold',
  [FONTS.headingMedium]: 'Helvetica-Bold',
  [FONTS.body]: 'Helvetica',
};

interface FontRegistration {
  key: FontKey;
  filename: string;
}

const REGISTRATIONS: FontRegistration[] = [
  { key: FONTS.heading, filename: 'Fraunces-Regular.ttf' },
  { key: FONTS.headingMedium, filename: 'Fraunces-Medium.ttf' },
  { key: FONTS.body, filename: 'Inter-Regular.ttf' },
];

let warnedMissing = false;

/**
 * Register the Fraunces/Inter font family on a PDFDocument, falling back to
 * the built-in Helvetica face if the TTF files aren't present on disk.
 *
 * Reads from `FONTS_PATH` env var if set, otherwise `./fonts` relative to
 * the process cwd. We log a single warning per process lifetime — the report
 * endpoint is noisy enough without spamming the console on every PDF.
 */
export function registerFonts(doc: PDFKit.PDFDocument): void {
  const basePath = process.env.FONTS_PATH || join(process.cwd(), 'fonts');

  for (const reg of REGISTRATIONS) {
    const full = join(basePath, reg.filename);
    try {
      if (existsSync(full)) {
        // Passing a Buffer avoids pdfkit trying to fs.readFile on its own,
        // which can be surprising under bundlers.
        const buf = readFileSync(full);
        doc.registerFont(reg.key, buf);
        continue;
      }
    } catch (err) {
      logger.warn(
        `Failed to load font "${reg.filename}" from ${basePath}: ${(err as Error).message}`,
      );
    }

    if (!warnedMissing) {
      logger.warn(
        `Custom fonts not found at ${basePath}; falling back to Helvetica. ` +
          `Set FONTS_PATH or drop Fraunces/Inter TTFs in ./fonts to improve typography.`,
      );
      warnedMissing = true;
    }
    doc.registerFont(reg.key, HELVETICA_FALLBACKS[reg.key]);
  }
}

/** Convenience helper — sets font + size in one call. */
export function useFont(doc: PDFKit.PDFDocument, key: FontKey, size: number): PDFKit.PDFDocument {
  return doc.font(key).fontSize(size);
}
