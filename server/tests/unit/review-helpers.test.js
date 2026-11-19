import { jest } from '@jest/globals';
import { negativeReviewEmail } from '../../src/services/email.service.js';
import { analyzeText } from '../../src/services/nlp.service.js';
import {
  mergeSpam,
  normalizeText,
  reviewerName,
  textKeyOf,
} from '../../src/services/review.service.js';

describe('text helpers', () => {
  it('normalises case, punctuation and spacing', () => {
    expect(normalizeText('  GREAT   product!!! ')).toBe('great product');
    expect(textKeyOf('Great product, really!')).toBe(textKeyOf('great  PRODUCT really'));
    expect(textKeyOf('Great product')).not.toBe(textKeyOf('Bad product'));
  });

  it('merges two spam scores as independent probabilities', () => {
    expect(mergeSpam(0, 0)).toBe(0);
    expect(mergeSpam(0.5, 0.4)).toBe(0.7);
    expect(mergeSpam(0.9, 0)).toBe(0.9);
    expect(mergeSpam(1, 0.3)).toBe(1);
  });

  it('shows only a first name and a last initial', () => {
    expect(reviewerName('Ali Khan')).toBe('Ali K.');
    expect(reviewerName('Sara')).toBe('Sara');
    expect(reviewerName('  mohammad  ali  raza ')).toBe('mohammad R.');
    expect(reviewerName(undefined)).toBe('Customer');
  });
});

describe('negativeReviewEmail', () => {
  it('escapes HTML in the review text', () => {
    const mail = negativeReviewEmail(
      { email: 's@example.com', name: 'S', seller: { businessName: 'Shop' } },
      { title: 'Mouse' },
      { rating: 1, text: '<script>alert(1)</script> broken' },
    );
    expect(mail.to).toBe('s@example.com');
    expect(mail.subject).toContain('1-star');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('analyzeText (NLP client)', () => {
  let spy;
  afterEach(() => jest.restoreAllMocks());
  const ok = (body) => ({ ok: true, json: async () => body });
  const good = { label: 'positive', score: 0.7, keywords: ['battery'], spam_score: 0.1, spam_reasons: ['link'] };

  it('sends the API key and maps the response', async () => {
    spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(ok(good));
    const result = await analyzeText({ text: 'Great battery life', rating: 5 });
    expect(result).toEqual({ label: 'positive', score: 0.7, keywords: ['battery'], spamScore: 0.1, spamReasons: ['link'] });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('http://nlp.test/analyze');
    expect(init.headers['X-API-Key']).toBe('nlp-test-key');
    expect(JSON.parse(init.body)).toEqual({ text: 'Great battery life', rating: 5 });
  });

  it('returns null (never throws) when the service fails, times out or answers badly', async () => {
    spy = jest.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    expect(await analyzeText({ text: 'x' })).toBeNull();
    spy.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect(await analyzeText({ text: 'x' })).toBeNull();
    spy.mockResolvedValueOnce(ok({ label: 'happy', score: 'high' }));
    expect(await analyzeText({ text: 'x' })).toBeNull();
  });

  it('clamps out-of-range numbers', async () => {
    spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ ...good, score: 5, spam_score: 3 }));
    const result = await analyzeText({ text: 'x' });
    expect(result.score).toBe(1);
    expect(result.spamScore).toBe(1);
  });
});
