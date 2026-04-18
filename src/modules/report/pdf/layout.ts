import type PDFKit from 'pdfkit';

/**
 * Shared visual language for generated PDFs.
 *
 * Mirrors the marketing-site palette: a warm cream canvas, near-black stone
 * ink for copy, a coral accent for emphasis, and a red reserved for negative
 * figures (overdue invoices, lateness highlights).
 */
export const COLORS = {
  cream: '#FAF6EF',
  stone: '#1C1B18',
  coral: '#E3643C',
  red: '#C03A2B',
  rule: '#D9D2C6',
  muted: '#6B665E',
} as const;

/** Page margin in PDF points (1pt = 1/72in). 48pt ≈ 17mm. */
export const MARGIN = 48;

/** Vertical spacing rhythm (pt). */
export const SPACING = {
  hairline: 0.6,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

/**
 * Draw a thin horizontal divider at (x, y) of width w using the shared rule
 * colour. Kept separate so stroke state can't leak into surrounding text.
 */
export function drawHairline(doc: PDFKit.PDFDocument, x: number, y: number, w: number): void {
  doc.save();
  doc
    .lineWidth(SPACING.hairline)
    .strokeColor(COLORS.rule)
    .moveTo(x, y)
    .lineTo(x + w, y)
    .stroke();
  doc.restore();
}
