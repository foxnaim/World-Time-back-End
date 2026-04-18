import { escapeHtml, layout, type RenderedEmail } from './shared';

interface AuthLinkInput {
  magicLink: string;
}

/**
 * Single-use magic link for email-based browser login. Short-lived tokens
 * should be baked into {@link AuthLinkInput.magicLink} by the auth module;
 * this template only renders the message.
 */
export function renderAuthLink(input: AuthLinkInput): RenderedEmail {
  const { magicLink } = input;
  const safeLink = escapeHtml(magicLink);

  const subject = 'Work Tact — Your sign-in link';
  const preheader = 'Tap the button below to finish signing in. This link expires shortly.';

  const bodyHtml = `
    <h1>Sign in to Tact</h1>
    <p>Tap the button below to finish signing in. For your safety this link can only be used once and will expire shortly.</p>
    <p><a class="button" href="${safeLink}">Sign in</a></p>
    <hr class="divider" />
    <p class="muted">If the button doesn't work, copy and paste this link into your browser:</p>
    <p class="fallback-link">${safeLink}</p>
    <p class="muted">If you didn't request a sign-in link, you can safely ignore this email — your account is unchanged.</p>
  `;

  const html = layout({ title: subject, preheader, bodyHtml });

  const text = [
    'Sign in to Work Tact',
    '',
    'Tap the link below to finish signing in. For your safety this link can only be used once and will expire shortly.',
    '',
    `Sign in: ${magicLink}`,
    '',
    "If you didn't request a sign-in link, you can safely ignore this email.",
  ].join('\n');

  return { subject, html, text };
}
