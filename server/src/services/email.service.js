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

const PROVIDERS = ['brevo', 'resend'];

// Pure function (easy to unit test): the HTTP request for one provider. No card data, no secrets in logs.
export function buildProviderRequest(provider, { to, subject, html }, { from, apiKey }) {
  const sender = parseFrom(from);
  if (provider === 'brevo') {
    return {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: { sender, to: [{ email: to }], subject, htmlContent: html },
    };
  }
  if (provider === 'resend') {
    return {
      url: 'https://api.resend.com/emails',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: {
        from: sender.name ? `${sender.name} <${sender.email}>` : sender.email,
        to: [to],
        subject,
        html,
      },
    };
  }
  throw new Error(`Unknown email provider: ${provider}`);
}

// Never throws: an email failure must not break the main action (SRS AC-NOTIFY).
export async function sendEmail({ to, subject, html }) {
  if (!PROVIDERS.includes(env.EMAIL_PROVIDER) || !env.EMAIL_API_KEY) {
    logger.info('email not sent (EMAIL_PROVIDER or EMAIL_API_KEY not set)', {
      to,
      subject,
      ...(env.NODE_ENV === 'development' && { html }),
    });
    return false;
  }
  try {
    const req = buildProviderRequest(
      env.EMAIL_PROVIDER,
      { to, subject, html },
      { from: env.MAIL_FROM, apiKey: env.EMAIL_API_KEY },
    );
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn('email provider rejected email', {
        provider: env.EMAIL_PROVIDER,
        status: res.status,
      });
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

// Money is stored as integer paisa; show it as "Rs 2,499.00".
export const formatMoney = (minor) =>
  `Rs ${(minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const itemRows = (items) =>
  items.map((i) => `<li>${esc(i.title)} x ${i.qty}: ${formatMoney(i.price * i.qty)}</li>`).join('');

export const orderConfirmationEmail = (customer, order, subOrders) => ({
  to: customer.email,
  subject: `SentiMart order confirmed (${formatMoney(order.total)})`,
  html: `<p>Hi ${esc(customer.name)},</p><p>Thanks for your order. Total: <strong>${formatMoney(order.total)}</strong> (${esc(order.paymentMethod)}).</p>${subOrders
    .map((s) => `<p>Package ${esc(String(s._id).slice(-6))}:</p><ul>${itemRows(s.items)}</ul>`)
    .join('')}<p>Delivery to: ${esc(order.address.line1)}, ${esc(order.address.city)}.</p>`,
});

export const newSubOrderEmail = (seller, subOrder, order) => ({
  to: seller.email,
  subject: `New order to fulfil (${formatMoney(subOrder.subtotal)})`,
  html: `<p>Hi ${esc(seller.seller?.businessName ?? seller.name)},</p><p>You have a new order.</p><ul>${itemRows(subOrder.items)}</ul><p>Ship to: ${esc(order.address.line1)}, ${esc(order.address.city)}.</p>`,
});

export const statusChangedEmail = (customer, subOrder) => ({
  to: customer.email,
  subject: `Your order is now ${subOrder.status}`,
  html: `<p>Hi ${esc(customer.name)},</p><p>Package ${esc(String(subOrder._id).slice(-6))} is now <strong>${esc(subOrder.status)}</strong>.</p><ul>${itemRows(subOrder.items)}</ul>`,
});

export const negativeReviewEmail = (seller, product, review) => ({
  to: seller.email,
  subject: `New ${review.rating}-star review on ${product.title}`,
  html: `<p>Hi ${esc(seller.seller?.businessName ?? seller.name)},</p><p>A customer left a ${review.rating}-star review on <strong>${esc(product.title)}</strong> that our analysis rates as negative.</p><blockquote>${esc(review.text)}</blockquote><p>You can reply to it from your seller dashboard.</p>`,
});

export const sellerApprovalEmail = (seller, status, reason) => ({
  to: seller.email,
  subject: status === 'approved' ? 'Your SentiMart seller account is approved' : 'Update on your SentiMart seller application',
  html:
    status === 'approved'
      ? `<p>Hi ${esc(seller.seller?.businessName ?? seller.name)},</p><p>Good news: your seller account is <strong>approved</strong>. You can now list products and receive orders.</p>`
      : `<p>Hi ${esc(seller.seller?.businessName ?? seller.name)},</p><p>We could not approve your seller account at this time.</p>${reason ? `<p>Reason: ${esc(reason)}</p>` : ''}<p>Your listings are hidden until this is resolved.</p>`,
});
