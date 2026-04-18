/**
 * Shared editorial styling for transactional emails. Cream background, warm
 * neutral palette, Fraunces display for headings (via Google Fonts link —
 * clients that block it fall back to Georgia/serif gracefully).
 *
 * Every template in this folder should call {@link layout} to wrap its body
 * so the palette stays consistent.
 */

export const palette = {
  cream: '#F6F1E7',
  card: '#FFFDF7',
  ink: '#1F1B16',
  muted: '#6B6459',
  accent: '#8B6A3F',
  accentDark: '#5C4523',
  hairline: '#E4DBC9',
} as const;

export const fontsLink =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Escape HTML-special characters so user-supplied strings (company name, etc.)
 * can be interpolated safely. Good-enough for transactional email bodies;
 * we're not building a browser UI here.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LayoutInput {
  title: string;
  preheader: string;
  bodyHtml: string;
}

export function layout({ title, preheader, bodyHtml }: LayoutInput): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="${fontsLink}" rel="stylesheet" />
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: ${palette.cream};
        color: ${palette.ink};
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .preheader {
        display: none !important;
        visibility: hidden;
        opacity: 0;
        color: transparent;
        height: 0;
        width: 0;
        overflow: hidden;
      }
      .wrapper {
        width: 100%;
        background-color: ${palette.cream};
        padding: 40px 16px;
      }
      .card {
        max-width: 560px;
        margin: 0 auto;
        background-color: ${palette.card};
        border: 1px solid ${palette.hairline};
        border-radius: 14px;
        padding: 40px 40px 32px;
        box-shadow: 0 1px 0 rgba(28, 21, 12, 0.04);
      }
      .brand {
        font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
        font-weight: 600;
        font-size: 14px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: ${palette.accent};
        margin: 0 0 28px;
      }
      h1 {
        font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
        font-weight: 600;
        font-size: 30px;
        line-height: 1.15;
        color: ${palette.ink};
        margin: 0 0 16px;
        letter-spacing: -0.01em;
      }
      p {
        font-size: 16px;
        line-height: 1.6;
        color: ${palette.ink};
        margin: 0 0 16px;
      }
      .muted {
        color: ${palette.muted};
        font-size: 14px;
        line-height: 1.5;
      }
      .button {
        display: inline-block;
        background-color: ${palette.accentDark};
        color: ${palette.card} !important;
        text-decoration: none;
        font-weight: 600;
        font-size: 15px;
        padding: 14px 24px;
        border-radius: 999px;
        margin: 8px 0 24px;
      }
      .divider {
        height: 1px;
        background-color: ${palette.hairline};
        border: 0;
        margin: 28px 0;
      }
      .fallback-link {
        word-break: break-all;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        color: ${palette.accentDark};
      }
      .footer {
        max-width: 560px;
        margin: 16px auto 0;
        padding: 0 40px;
        font-size: 12px;
        color: ${palette.muted};
        text-align: center;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <span class="preheader">${escapeHtml(preheader)}</span>
    <div class="wrapper">
      <div class="card">
        <p class="brand">Tact</p>
        ${bodyHtml}
      </div>
      <p class="footer">You're receiving this because Work Tact is helping manage your team's schedule. If this wasn't expected, you can safely ignore it.</p>
      <p class="footer">© Work Tact · ритм рабочего дня</p>
    </div>
  </body>
</html>`;
}
