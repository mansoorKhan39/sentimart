import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function parseFrom(value) {
  const m = value.match(/^(.*)<(.+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { email: value.trim() };
}

// Never throws: an email failure must not break the main action (SRS AC-NOTIFY).
export async function sendEmail({ to, subject, html }) {
  if (!env.SENDGRID_API_KEY) {
    logger.info('email not sent (no SENDGRID_API_KEY)', {
      to,
      subject,
      ...(env.NODE_ENV === 'development' && { html }),
    });
    return false;
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: parseFrom(env.MAIL_FROM),
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn('sendgrid rejected email', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('email failed', { error: err.message });
    return false;
  }
}

export const welcomeEmail = (user) => ({
  to: user.email,
  subject: 'Welcome to SentiMart',
  html: `<p>Hi ${esc(user.name)},</p><p>Your SentiMart account is ready.</p>${
    user.role === 'seller' ? '<p>Your seller account is pending admin approval.</p>' : ''
  }`,
});

export const resetPasswordEmail = (user, url) => ({
  to: user.email,
  subject: 'Reset your SentiMart password',
  html: `<p>Hi ${esc(user.name)},</p><p><a href="${esc(url)}">Reset your password</a>. The link works once and expires in ${env.RESET_TOKEN_TTL_MIN} minutes.</p><p>If you did not ask for this, ignore this email.</p>`,
});
