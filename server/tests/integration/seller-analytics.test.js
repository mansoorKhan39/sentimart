import request from 'supertest';
import app from '../../src/app.js';
import { DAY, startOfUtcDay } from '../../src/utils/dates.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeReview, makeSale, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
// Midday of N days ago (UTC): safely inside that day's bucket, whatever time the tests run.
const at = (daysAgo) => new Date(startOfUtcDay(new Date()).getTime() - daysAgo * DAY + 12 * 3_600_000);
const key = (daysAgo) => at(daysAgo).toISOString().slice(0, 10);
const get = (path, who) => request(app).get(api(path)).set(who.auth);

let mongod;
let sellerA;
let sellerB;
let customer;
let p1;
let p2;
let pB;

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  sellerA = await makeUser({ role: 'seller' });
  sellerB = await makeUser({ role: 'seller' });
  customer = await makeUser();
  const category = await makeCategory();
  p1 = await makeProduct(sellerA.user._id, category._id, { title: 'Mouse', price: 100000 });
  p2 = await makeProduct(sellerA.user._id, category._id, { title: 'Keyboard', price: 50000 });
  pB = await makeProduct(sellerB.user._id, category._id, { title: 'Other' });
});

const sale = (seller, lines, status, createdAt) =>
  makeSale({ seller: seller.user, customer: customer.user, lines, status, createdAt });

describe('access', () => {
  it('is for sellers only', async () => {
    expect((await request(app).get(api('/seller/analytics/sales'))).status).toBe(401);
    expect((await get('/seller/analytics/sales', customer)).status).toBe(403);
    const admin = await makeUser({ role: 'admin' });
    expect((await get('/seller/analytics/sales', admin)).status).toBe(403);
  });

  it('shows empty numbers to a seller without sales (also a pending seller)', async () => {
    const pending = await makeUser({ role: 'seller', approval: 'pending' });
    const res = await get('/seller/analytics/sales?range=7d', pending);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toEqual({ revenue: 0, orders: 0, avgOrderValue: 0, cancelled: 0 });
    expect(res.body.data.series).toHaveLength(7);
  });
});

describe('sales analytics', () => {
  beforeEach(async () => {
    await sale(sellerA, [{ product: p1, qty: 2 }], 'Delivered', at(1));
    await sale(sellerA, [{ product: p2, qty: 1 }], 'Pending', at(1));
    await sale(sellerA, [{ product: p1, qty: 1 }], 'Cancelled', at(3));
    await sale(sellerA, [{ product: p1, qty: 1 }], 'Delivered', at(10));
    await sale(sellerB, [{ product: pB, qty: 5 }], 'Delivered', at(1)); // someone else's money
  });

  it('adds up revenue (cancelled excluded) and fills every day of the range', async () => {
    const { data } = (await get('/seller/analytics/sales?range=7d', sellerA)).body;
    expect(data.totals).toEqual({ revenue: 250000, orders: 2, avgOrderValue: 125000, cancelled: 1 });
    expect(data.series).toHaveLength(7);
    expect(data.series.find((d) => d.date === key(1))).toEqual({ date: key(1), revenue: 250000, orders: 2 });
    expect(data.series.filter((d) => d.date !== key(1)).every((d) => d.revenue === 0 && d.orders === 0)).toBe(true);
    expect(data.byStatus).toEqual({ Pending: 1, Confirmed: 0, Shipped: 0, Delivered: 1, Cancelled: 1 });
    expect(data.topProducts).toEqual([
      expect.objectContaining({ title: 'Mouse', units: 2, revenue: 200000 }),
      expect.objectContaining({ title: 'Keyboard', units: 1, revenue: 50000 }),
    ]);
  });

  it('a longer range includes older sales', async () => {
    const { data } = (await get('/seller/analytics/sales?range=30d', sellerA)).body;
    expect(data.totals.revenue).toBe(350000);
    expect(data.totals.orders).toBe(3);
    expect(data.series).toHaveLength(30);
  });

  it('groups by week (Mondays) or day on request', async () => {
    const weekly = (await get('/seller/analytics/sales?range=90d', sellerA)).body.data;
    expect(weekly.range.interval).toBe('week');
    expect(weekly.series.every((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(weekly.series.reduce((sum, d) => sum + d.revenue, 0)).toBe(350000);
    const daily = (await get('/seller/analytics/sales?range=90d&interval=day', sellerA)).body.data;
    expect(daily.series).toHaveLength(90);
  });

  it('accepts a from/to window', async () => {
    const { data } = (await get(`/seller/analytics/sales?from=${key(1)}&to=${key(1)}`, sellerA)).body;
    expect(data.series).toHaveLength(1);
    expect(data.series[0].revenue).toBe(250000);
  });

  it('rejects bad ranges', async () => {
    expect((await get('/seller/analytics/sales?range=1y', sellerA)).status).toBe(422);
    expect((await get(`/seller/analytics/sales?from=${key(1)}&to=${key(5)}`, sellerA)).status).toBe(422);
    expect((await get(`/seller/analytics/sales?from=${key(500)}&to=${key(1)}`, sellerA)).status).toBe(422);
    expect((await get('/seller/analytics/sales?interval=hour', sellerA)).status).toBe(422);
  });
});

describe('sentiment trend', () => {
  beforeEach(async () => {
    const a = customer.user;
    await makeReview({ product: p1, author: a, label: 'positive', rating: 5, createdAt: at(1) });
    await makeReview({ product: p1, author: a, label: 'negative', rating: 1, createdAt: at(1) });
    await makeReview({ product: p1, author: a, label: 'neutral', rating: 3, createdAt: at(2) });
    await makeReview({ product: p1, author: a, analysisStatus: 'pending', rating: 4, createdAt: at(1) });
    await makeReview({ product: p1, author: a, label: 'positive', status: 'flagged', createdAt: at(1) });
    await makeReview({ product: pB, author: a, label: 'positive', createdAt: at(1) });
    await makeReview({ product: p1, author: a, label: 'positive', createdAt: at(40) });
  });

  it('counts only published reviews of this seller inside the range', async () => {
    const { data } = (await get('/seller/analytics/sentiment?range=30d', sellerA)).body;
    expect(data.overall).toEqual({
      reviews: 4, positive: 1, neutral: 1, negative: 1, pending: 1,
      avgScore: 0, avgRating: 3.25, sentimentIndex: 50,
    });
    expect(data.series).toHaveLength(30);
    expect(data.series.find((d) => d.date === key(1))).toEqual({
      date: key(1), reviews: 3, positive: 1, neutral: 0, negative: 1, avgScore: 0,
    });
    expect(data.series.find((d) => d.date === key(2)).neutral).toBe(1);
  });

  it('a longer range adds the older review', async () => {
    const { data } = (await get('/seller/analytics/sentiment?range=365d', sellerA)).body;
    expect(data.range.interval).toBe('month');
    expect(data.overall.reviews).toBe(5);
    expect(data.overall.positive).toBe(2);
  });

  it('filters by product and refuses other sellers products', async () => {
    const none = (await get(`/seller/analytics/sentiment?productId=${p2._id}`, sellerA)).body.data;
    expect(none.overall).toMatchObject({ reviews: 0, avgScore: null, sentimentIndex: null });
    expect((await get(`/seller/analytics/sentiment?productId=${pB._id}`, sellerA)).status).toBe(404);
    expect((await get('/seller/analytics/sentiment?productId=bad', sellerA)).status).toBe(422);
  });
});

describe('top complaints', () => {
  beforeEach(async () => {
    const a = customer.user;
    const negative = (product, keywords, extra = {}) =>
      makeReview({ product, author: a, label: 'negative', keywords, createdAt: at(2), ...extra });
    await negative(p1, ['battery', 'not working']);
    await negative(p1, ['battery', 'slow']);
    await negative(p1, ['battery']);
    await negative(p2, ['battery']);
    await makeReview({ product: p1, author: a, label: 'positive', keywords: ['battery'], createdAt: at(2) });
    await negative(p1, ['battery'], { status: 'flagged' });
    await negative(pB, ['battery']);
  });

  it('ranks the most mentioned complaint words from negative published reviews', async () => {
    const { data } = (await get('/seller/analytics/complaints', sellerA)).body;
    expect(data.complaints[0]).toMatchObject({ keyword: 'battery', count: 4, productCount: 2 });
    expect(data.complaints.map((c) => c.keyword)).toEqual(['battery', 'not working', 'slow']);
    expect(data.negativeReviews).toBe(4);
    expect(data.totalReviews).toBe(5);
    expect(data.negativeShare).toBe(80);
    expect(data.complaints[0].sample.length).toBeLessThanOrEqual(140);
  });

  it('supports a limit and a product filter', async () => {
    expect((await get('/seller/analytics/complaints?limit=1', sellerA)).body.data.complaints).toHaveLength(1);
    const one = (await get(`/seller/analytics/complaints?productId=${p2._id}`, sellerA)).body.data;
    expect(one.complaints).toEqual([expect.objectContaining({ keyword: 'battery', count: 1 })]);
    expect((await get('/seller/analytics/complaints?limit=100', sellerA)).status).toBe(422);
  });
});

describe('CSV export (FR-35)', () => {
  it('downloads sales as a CSV file with money in rupees', async () => {
    await sale(sellerA, [{ product: p1, qty: 2 }, { product: p2, qty: 1 }], 'Delivered', at(1));
    const res = await get('/seller/analytics/export?type=sales&range=7d', sellerA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="sentimart-sales-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('date,revenue_pkr,orders');
    expect(lines).toHaveLength(8); // header + 7 days
    expect(lines).toContain(`${key(1)},2500.00,1`);
  });

  it('exports sentiment and complaints too, and defuses formulas', async () => {
    await makeReview({
      product: p1, author: customer.user, label: 'negative', keywords: ['=HYPERLINK("http://x")'], createdAt: at(1),
    });
    const sentiment = await get('/seller/analytics/export?type=sentiment&range=7d', sellerA);
    expect(sentiment.text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('date,reviews,positive,neutral,negative,avg_score');
    const complaints = await get('/seller/analytics/export?type=complaints', sellerA);
    expect(complaints.text).toContain('keyword,mentions,products');
    expect(complaints.text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('validates the type', async () => {
    expect((await get('/seller/analytics/export', sellerA)).status).toBe(422);
    expect((await get('/seller/analytics/export?type=users', sellerA)).status).toBe(422);
    expect((await get('/seller/analytics/export?type=sales', customer)).status).toBe(403);
  });
});
