import { escapeHtml, layout, type RenderedEmail } from './shared';

interface EmployeeInviteInput {
  companyName: string;
  inviteLink: string;
  telegramBotUsername?: string;
}

/**
 * Fallback channel for onboarding an employee whose phone number we don't
 * know yet — we can't DM them on Telegram, but we can email them a one-tap
 * link that opens the bot's deep link after they click Start.
 */
export function renderEmployeeInvite(input: EmployeeInviteInput): RenderedEmail {
  const { companyName, inviteLink, telegramBotUsername } = input;
  const safeCompany = escapeHtml(companyName);
  const safeLink = escapeHtml(inviteLink);
  const botHandle = telegramBotUsername ? `@${telegramBotUsername.replace(/^@/, '')}` : undefined;

  const subject = `Work Tact — You're invited to join ${companyName}`;
  const preheader = `Tap the link below to join ${companyName} and start logging your hours.`;

  const botLine = botHandle
    ? `<p class="muted">After tapping the link, Telegram will open our bot ${escapeHtml(botHandle)}. Press <strong>Start</strong> and you're in.</p>`
    : '';

  const bodyHtml = `
    <h1>You're invited to ${safeCompany}</h1>
    <p>Your manager at <strong>${safeCompany}</strong> added you to Work Tact so you can check in, check out, and see your hours — all from Telegram.</p>
    <p><a class="button" href="${safeLink}">Accept invitation</a></p>
    ${botLine}
    <hr class="divider" />
    <p class="muted">If the button doesn't work, copy and paste this link into your browser:</p>
    <p class="fallback-link">${safeLink}</p>
  `;

  const html = layout({ title: subject, preheader, bodyHtml });

  const text = [
    `You're invited to ${companyName}`,
    '',
    `Your manager at ${companyName} added you to Work Tact so you can check in, check out, and see your hours — all from Telegram.`,
    '',
    `Accept your invitation: ${inviteLink}`,
    botHandle
      ? `After tapping the link, Telegram will open ${botHandle}. Press Start and you're in.`
      : '',
    '',
    "If this wasn't expected, you can safely ignore this email.",
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
