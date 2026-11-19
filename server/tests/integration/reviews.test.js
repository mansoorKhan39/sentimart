import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../src/app.js';
import { Product } from '../../src/models/product.model.js';
import { Review } from '../../src/models/review.model.js';
import { retryPending } from '../../src/services/review.service.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makePackage, makeProduct, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
const GOOD = { rating: 5, text: 'Excellent quality, works perfectly and arrived early.' };
const BAD = { rating: 2, text: 'Terrible build, it broke after two days of normal use.' };

let mongod;
let customer;
let buyer2;
let sellerA;
let sellerB;
let product;
let product2;
let nlpMode = 'ok'; // ok | spam | down | http500
let fetchSpy;

const nlpCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('nlp.test'));
const post = (who, productId, body = GOOD) =>
  request(app).post(api(`/products/${productId}/reviews`)).set(who.auth).send(body);
const list = (productId, query = '') => request(app).get(api(`/products/${productId}/reviews${query}`));
const statsOf = async (p = product) => (await Product.findById(p._id)).toObject();
const deliver = (who = customer, p = product) => makePackage(who.user, p);

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  nlpMode = 'ok';
  customer = await makeUser();
  buyer2 = await makeUser();
  sellerA = await makeUser({ role: 'seller' });
  sellerB = await makeUser({ role: 'seller' });
  const category = await makeCategory();
  product = await makeProduct(sellerA.user._id, category._id, { title: 'Mouse' });
  product2 = await makeProduct(sellerA.user._id, category._id, { title: 'Keyboard' });
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (nlpMode === 'down') throw new Error('connect ECONNREFUSED');
    if (nlpMode === 'http500') return { ok: false, status: 500, json: async () => ({}) };
    const negative = /terrible|broke|awful/i.test(JSON.parse(init.body).text);
    return {
      ok: true,
      json: async () => ({
        label: negative ? 'negative' : 'positive',
        score: negative ? -0.6 : 0.6,
        keywords: negative ? ['broke', 'terrible'] : ['quality', 'perfectly'],
        spam_score: nlpMode === 'spam' ? 0.9 : 0.05,
        spam_reasons: nlpMode === 'spam' ? ['link'] : [],
      }),
    };
  });
});
afterEach(() => jest.restoreAllMocks());

describe('who may review (AC-REVIEW)', () => {
  it('needs a logged-in customer', async () => {
    expect((await request(app).post(api(`/products/${product._id}/reviews`)).send(GOOD)).status).toBe(401);
    expect((await post(sellerA, product._id)).status).toBe(403);
  });

  it('refuses buyers whose package is not delivered yet, and never calls the NLP service', async () => {
    expect((await post(customer, product._id)).body.error.code).toBe('NOT_ELIGIBLE');
    await makePackage(customer.user, product, 'Shipped');
    const res = await post(customer, product._id);
    expect(res.status).toBe(403);
    expect(nlpCalls()).toHaveLength(0);
  });

  it('allows one review per delivered package; a second delivered order allows another', async () => {
    await deliver();
    expect((await post(customer, product._id)).status).toBe(201);
    const again = await post(customer, product._id, BAD);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REVIEWED');
    await deliver();
    expect((await post(customer, product._id, BAD)).status).toBe(201);
  });

  it('does not let a package for another product unlock this one', async () => {
    await deliver(customer, product2);
    expect((await post(customer, product._id)).status).toBe(403);
  });

  it('reports eligibility for the review form', async () => {
    const check = async () => (await request(app).get(api(`/products/${product._id}/reviews/eligibility`)).set(customer.auth)).body.data;
    expect(await check()).toEqual({ eligible: false, reason: 'not_delivered' });
    await deliver();
    expect(await check()).toEqual({ eligible: true, reason: null });
    await post(customer, product._id);
    expect(await check()).toEqual({ eligible: false, reason: 'already_reviewed' });
  });

  it('validates rating and text', async () => {
    await deliver();
    for (const body of [
      { ...GOOD, rating: 0 },
      { ...GOOD, rating: 6 },
      { ...GOOD, rating: 4.5 },
      { ...GOOD, rating: '5' },
      { ...GOOD, text: 'short' },
      { ...GOOD, text: 'x'.repeat(2001) },
      { ...GOOD, status: 'published' },
      { rating: 5 },
    ]) {
      expect((await post(customer, product._id, body)).status).toBe(422);
    }
    expect((await post(customer, '64b7f8f8f8f8f8f8f8f8f8f8')).status).toBe(404);
  });
});

describe('sentiment analysis (TC-12)', () => {
  it('stores label, score and keywords and updates the product numbers', async () => {
    await deliver();
    const res = await post(customer, product._id);
    expect(res.status).toBe(201);
    expect(res.body.data.review).toMatchObject({
      rating: 5,
      status: 'published',
      analysisStatus: 'done',
      sentiment: { label: 'positive', score: 0.6, keywords: ['quality', 'perfectly'] },
      author: { name: expect.stringMatching(/^Test/) },
    });
    const [url, init] = nlpCalls()[0];
    expect(url).toBe('http://nlp.test/analyze');
    expect(init.headers['X-API-Key']).toBe('nlp-test-key');
    expect(JSON.parse(init.body)).toEqual({ text: GOOD.text, rating: 5 });

    const stats = await statsOf();
    expect(stats.avgRating).toBe(5);
    expect(stats.reviewCount).toBe(1);
    expect(stats.sentiment).toMatchObject({ positive: 1, neutral: 0, negative: 0 });
    expect(stats.sentiment.avgScore).toBeCloseTo(0.6);
  });

  it('recalculates the average with every review', async () => {
    await deliver();
    await deliver(buyer2);
    await post(customer, product._id);
    await post(buyer2, product._id, { rating: 3, text: BAD.text });
    const stats = await statsOf();
    expect(stats.avgRating).toBe(4);
    expect(stats.reviewCount).toBe(2);
    expect(stats.sentiment).toMatchObject({ positive: 1, negative: 1 });
    expect(stats.sentiment.avgScore).toBeCloseTo(0);
  });
});

describe('NLP service unavailable (TC-13)', () => {
  it.each([['down'], ['http500']])('saves the review as pending when the service is %s', async (mode) => {
    nlpMode = mode;
    await deliver();
    const res = await post(customer, product._id);
    expect(res.status).toBe(201);
    expect(res.body.data.review).toMatchObject({ analysisStatus: 'pending', sentiment: null, status: 'published' });
    const stats = await statsOf();
    expect(stats.reviewCount).toBe(1);
    expect(stats.avgRating).toBe(5);
    expect(stats.sentiment).toMatchObject({ positive: 0, neutral: 0, negative: 0 });
  });

  it('analyses the review automatically later and updates the sentiment numbers', async () => {
    nlpMode = 'down';
    await deliver();
    await post(customer, product._id);
    nlpMode = 'ok';
    const result = await retryPending({ minAgeMs: 0 });
    expect(result).toEqual({ checked: 1, analyzed: 1 });
    const review = await Review.findOne({ productId: product._id });
    expect(review.analysisStatus).toBe('done');
    expect(review.sentiment.label).toBe('positive');
    expect((await statsOf()).sentiment.positive).toBe(1);
  });

  it('stops after the first failure when the service is still down', async () => {
    nlpMode = 'down';
    await deliver();
    await deliver(buyer2);
    await post(customer, product._id);
    await post(buyer2, product._id);
    const result = await retryPending({ minAgeMs: 0 });
    expect(result).toEqual({ checked: 2, analyzed: 0 });
    expect(nlpCalls().length).toBe(3); // 2 submissions + only 1 retry
  });

  it('does not retry on every page view (at most once a minute per review)', async () => {
    nlpMode = 'down';
    await deliver();
    await post(customer, product._id);
    const before = nlpCalls().length;
    expect((await list(product._id)).status).toBe(200);
    expect(nlpCalls().length).toBe(before);
  });
});

describe('fake and spam reviews (TC-14)', () => {
  it('flags a review the NLP service scores as spam: hidden from the public, not counted', async () => {
    nlpMode = 'spam';
    await deliver();
    const res = await post(customer, product._id);
    expect(res.status).toBe(201);
    expect(res.body.data.review.status).toBe('flagged');
    expect((await list(product._id)).body.data.items).toHaveLength(0);
    expect((await statsOf()).reviewCount).toBe(0);
    const stored = await Review.findOne({ productId: product._id });
    expect(stored.spamReasons).toContain('link');
  });

  it('flags a copy-pasted review from another customer (history check in the API)', async () => {
    await deliver();
    await deliver(buyer2);
    await post(customer, product._id);
    const copy = await post(buyer2, product._id);
    expect(copy.body.data.review.status).toBe('flagged');
    const stored = await Review.findOne({ authorId: buyer2.user._id });
    expect(stored.spamReasons).toContain('duplicate_text');
    expect(stored.spamScore).toBeGreaterThanOrEqual(0.7);
  });

  it('does not treat very short generic reviews as copies', async () => {
    await deliver();
    await deliver(buyer2);
    const short = { rating: 5, text: 'Great item!!' };
    await post(customer, product._id, short);
    expect((await post(buyer2, product._id, short)).body.data.review.status).toBe('published');
  });

  it('flags burst posting: 5 reviews within 10 minutes', async () => {
    await Review.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        productId: new mongoose.Types.ObjectId(),
        authorId: customer.user._id,
        subOrderId: new mongoose.Types.ObjectId(),
        rating: 4,
        text: `Some earlier review number ${i} with enough words`,
        analysisStatus: 'done',
        sentiment: { label: 'positive', score: 0.4, keywords: [] },
      })),
    );
    await deliver();
    const res = await post(customer, product._id);
    expect(res.body.data.review.status).toBe('flagged');
    expect((await Review.findOne({ productId: product._id })).spamReasons).toContain('burst_posting');
  });
});

describe('public review list', () => {
  it('shows published reviews with a short reviewer name, never an email', async () => {
    await deliver();
    await deliver(buyer2);
    await post(customer, product._id);
    nlpMode = 'spam';
    await post(buyer2, product._id, BAD);
    const res = await list(product._id);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|authorId|textKey|spamScore/);
    expect(res.body.data.summary).toMatchObject({
      reviewCount: 1,
      avgRating: 5,
      ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    });
  });

  it('filters by sentiment and paginates', async () => {
    await deliver();
    await deliver(buyer2);
    await post(customer, product._id);
    await post(buyer2, product._id, BAD);
    const negative = await list(product._id, '?sentiment=negative');
    expect(negative.body.data.items.map((r) => r.sentiment.label)).toEqual(['negative']);
    const page = await list(product._id, '?limit=1&page=2');
    expect(page.body.data).toMatchObject({ total: 2, totalPages: 2, limit: 1 });
    expect((await list(product._id, '?limit=500')).body.data.limit).toBe(50);
    expect((await list(product._id, '?sentiment=angry')).status).toBe(422);
  });

  it('is public, but only for active products', async () => {
    expect((await list(product._id)).status).toBe(200);
    expect((await list('64b7f8f8f8f8f8f8f8f8f8f8')).status).toBe(404);
    await Product.updateOne({ _id: product._id }, { status: 'hidden' });
    expect((await list(product._id)).status).toBe(404);
  });
});

describe('edit and delete within 7 days', () => {
  let reviewId;
  beforeEach(async () => {
    await deliver();
    reviewId = (await post(customer, product._id)).body.data.review.id;
  });
  const patch = (who, body) => request(app).patch(api(`/reviews/${reviewId}`)).set(who.auth).send(body);
  const age = (days) =>
    Review.collection.updateOne({ _id: new mongoose.Types.ObjectId(reviewId) }, { $set: { createdAt: new Date(Date.now() - days * 86_400_000) } });

  it('lets the author edit: re-analysed, marked as edited, numbers updated', async () => {
    const res = await patch(customer, BAD);
    expect(res.status).toBe(200);
    expect(res.body.data.review).toMatchObject({ rating: 2, sentiment: { label: 'negative' } });
    expect(res.body.data.review.editedAt).toBeTruthy();
    const stats = await statsOf();
    expect(stats.avgRating).toBe(2);
    expect(stats.sentiment).toMatchObject({ positive: 0, negative: 1 });
  });

  it("hides other people's reviews behind 404 and rejects empty edits", async () => {
    expect((await patch(buyer2, BAD)).status).toBe(404);
    expect((await request(app).delete(api(`/reviews/${reviewId}`)).set(buyer2.auth)).status).toBe(404);
    expect((await patch(customer, {})).status).toBe(422);
  });

  it('deletes and recalculates', async () => {
    expect((await request(app).delete(api(`/reviews/${reviewId}`)).set(customer.auth)).status).toBe(200);
    expect((await statsOf()).reviewCount).toBe(0);
    expect((await list(product._id)).body.data.items).toHaveLength(0);
  });

  it('closes after 7 days', async () => {
    await age(8);
    const res = await patch(customer, BAD);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EDIT_WINDOW_CLOSED');
    expect((await request(app).delete(api(`/reviews/${reviewId}`)).set(customer.auth)).status).toBe(409);
  });
});

describe('seller reply', () => {
  let reviewId;
  beforeEach(async () => {
    await deliver();
    reviewId = (await post(customer, product._id)).body.data.review.id;
  });
  const reply = (who, text = 'Thank you for your feedback!') =>
    request(app).post(api(`/reviews/${reviewId}/reply`)).set(who.auth).send({ text });

  it('lets the product owner reply and shows it publicly', async () => {
    expect((await reply(sellerA)).status).toBe(200);
    const item = (await list(product._id)).body.data.items[0];
    expect(item.reply.text).toBe('Thank you for your feedback!');
  });

  it('blocks other sellers and customers, and validates the text', async () => {
    expect((await reply(sellerB)).status).toBe(403);
    expect((await reply(customer)).status).toBe(403);
    expect((await reply(sellerA, 'x')).status).toBe(422);
  });
});

describe('retry endpoint for the daily cron (needs the secret)', () => {
  it('rejects missing or wrong secrets', async () => {
    expect((await request(app).get(api('/internal/retry-pending'))).status).toBe(401);
    expect((await request(app).get(api('/internal/retry-pending')).set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('analyses pending reviews when called with the secret', async () => {
    nlpMode = 'down';
    await deliver();
    await post(customer, product._id);
    nlpMode = 'ok';
    await Review.updateOne({ productId: product._id }, { lastAnalysisAt: new Date(Date.now() - 120_000) });
    const res = await request(app).get(api('/internal/retry-pending')).set('Authorization', 'Bearer cron-test-secret');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ checked: 1, analyzed: 1 });
  });
});
