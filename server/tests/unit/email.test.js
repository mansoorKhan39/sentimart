import {
  buildProviderRequest,
  formatMoney,
  newSubOrderEmail,
  orderConfirmationEmail,
  sendEmail,
} from '../../src/services/email.service.js';

const msg = { to: 'ali@example.com', subject: 'Hello', html: '<p>Hi</p>' };
const cfg = { from: 'SentiMart <no-reply@example.com>', apiKey: 'key-123' };

describe('email provider requests', () => {
  it('builds a Brevo request', () => {
    const req = buildProviderRequest('brevo', msg, cfg);
    expect(req.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(req.headers['api-key']).toBe('key-123');
    expect(req.body).toEqual({
      sender: { name: 'SentiMart', email: 'no-reply@example.com' },
      to: [{ email: 'ali@example.com' }],
      subject: 'Hello',
      htmlContent: '<p>Hi</p>',
    });
  });

  it('builds a Resend request', () => {
    const req = buildProviderRequest('resend', msg, cfg);
    expect(req.url).toBe('https://api.resend.com/emails');
    expect(req.headers.Authorization).toBe('Bearer key-123');
    expect(req.body).toMatchObject({
      from: 'SentiMart <no-reply@example.com>',
      to: ['ali@example.com'],
      html: '<p>Hi</p>',
    });
  });

  it('rejects an unknown provider', () => {
    expect(() => buildProviderRequest('smtp', msg, cfg)).toThrow(/Unknown email provider/);
  });

  it('does not send (and does not throw) when no provider is configured', async () => {
    expect(await sendEmail(msg)).toBe(false); // setup-env sets EMAIL_PROVIDER=none
  });
});

describe('email content', () => {
  it('formats paisa as rupees with thousands separators', () => {
    expect(formatMoney(249900)).toBe('Rs 2,499.00');
    expect(formatMoney(100)).toBe('Rs 1.00');
    expect(formatMoney(123456789)).toBe('Rs 1,234,567.89');
  });

  it('escapes user-controlled text so names cannot inject HTML', () => {
    const order = {
      total: 100000,
      paymentMethod: 'COD',
      address: { line1: '<img src=x>', city: 'Isb' },
    };
    const subs = [
      { _id: 'abc123456', items: [{ title: '<script>alert(1)</script>', price: 100000, qty: 1 }] },
    ];
    const mail = orderConfirmationEmail({ name: '<b>Ali</b>', email: 'a@b.com' }, order, subs);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;script&gt;');
    const sellerMail = newSubOrderEmail(
      { name: 'S', seller: { businessName: '<i>X</i>' }, email: 's@b.com' },
      subs[0],
      order,
    );
    expect(sellerMail.html).not.toContain('<i>X</i>');
  });
});
