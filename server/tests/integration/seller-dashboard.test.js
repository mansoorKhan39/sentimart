import request from 'supertest';
import app from '../../src/app.js';
import { DAY, startOfUtcDay } from '../../src/utils/dates.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeReview, makeSale, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
const at = (daysAgo) => new Date(startOfUtcDay(new Date()).getTime() - daysAgo * DAY + 12 * 3_600_000);
const get = (path, who) => request(app).get(api(path)).set(who.auth);

let mongod;
let seller;
let other;
let customer;
let category;

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  seller = await makeUser({ role: 'seller' });
  other = await makeUser({ role: 'seller' });
  customer = await makeUser();
  category = await makeCategory();
});

describe('dashboard overview (KPI cards)', () => {
  it('summarises sales, to-do counts, stock, rating, sentiment and unanswered complaints', async () => {
    const p1 = await makeProduct(seller.user._id, category._id, {
      title: 'Mouse', price: 100000, stock: 3, avgRating: 4, reviewCount: 2,
      sentiment: { positive: 1, neutral: 0, negative: 1, avgScore: 0.2 },
    });
    const p2 = await makeProduct(seller.user._id, category._id, {
      title: 'Keyboard', price: 50000, stock: 0, avgRating: 5, reviewCount: 1,
      sentiment: { positive: 1, neutral: 0, negative: 0, avgScore: 0.8 },
    });
    await makeProduct(seller.user._id, category._id, { stock: 50 });
    const sold = (lines, status, createdAt) =>
      makeSale({ seller: seller.user, customer: customer.user, lines, status, createdAt });
    await sold([{ product: p1 }], 'Delivered', at(5));
    await sold([{ product: p2 }], 'Pending', at(2));
    await sold([{ product: p1 }], 'Confirmed', at(3));
    await sold([{ product: p1 }], 'Delivered', at(35)); // previous 30 days
    await sold([{ product: p1 }], 'Cancelled', at(4)); // never counts as revenue

    const a = customer.user;
    await makeReview({ product: p1, author: a, label: 'negative' });
    await makeReview({ product: p1, author: a, label: 'negative', reply: 'Sorry about that!' });
    await makeReview({ product: p1, author: a, label: 'negative', status: 'flagged' });
    await makeReview({ product: p1, author: a, label: 'positive' });

    const { data } = (await get('/seller/analytics/overview', seller)).body;
    expect(data.revenue).toEqual({ current: 250000, previous: 100000, changePct: 150 });
    expect(data.orders).toEqual({ current: 3, previous: 1, changePct: 200 });
    expect(data.toConfirm).toBe(1);
    expect(data.toShip).toBe(1);
    expect(data.inventory).toEqual({ products: 3, active: 3, lowStock: 1, outOfStock: 1 });
    expect(data.rating).toEqual({ avg: 4.33, count: 3 });
    expect(data.sentiment).toEqual({ avgScore: 0.4, index: 70, analyzed: 3 });
    expect(data.unrepliedNegative).toBe(1);
  });

  it('is all zeros (and null where there is nothing to compare) for a new seller', async () => {
    const { data } = (await get('/seller/analytics/overview', seller)).body;
    expect(data.revenue).toEqual({ current: 0, previous: 0, changePct: null });
    expect(data.inventory).toEqual({ products: 0, active: 0, lowStock: 0, outOfStock: 0 });
    expect(data.rating).toEqual({ avg: null, count: 0 });
    expect(data.sentiment.index).toBeNull();
  });
});

describe('inventory', () => {
  beforeEach(async () => {
    const make = (title, stock, extra) => makeProduct(seller.user._id, category._id, { title, stock, ...extra });
    await make('Alpha Cable', 50);
    await make('Beta Charger', 3);
    await make('Gamma Dock', 0);
    await make('Delta Hub', 5); // exactly at the threshold: still "low"
    await make('Epsilon Hidden', 40, { status: 'hidden' });
    await makeProduct(other.user._id, category._id, { title: 'Not Mine', stock: 1 });
  });

  it('lists only my products, lowest stock first, with a summary for the badges', async () => {
    const { data } = (await get('/seller/inventory', seller)).body;
    expect(data.items.map((p) => p.title)).toEqual(['Gamma Dock', 'Beta Charger', 'Delta Hub', 'Epsilon Hidden', 'Alpha Cable']);
    expect(data.summary).toEqual({ total: 5, low: 2, out: 1, threshold: 5 });
    expect(data.items.find((p) => p.title === 'Delta Hub').lowStock).toBe(true);
    expect(data.items.find((p) => p.title === 'Gamma Dock').lowStock).toBe(false); // out of stock is its own state
    expect(data.items.find((p) => p.title === 'Epsilon Hidden').status).toBe('hidden');
  });

  it('filters low and out of stock, searches by title and paginates', async () => {
    const titles = async (query) => (await get(`/seller/inventory${query}`, seller)).body.data.items.map((p) => p.title);
    expect(await titles('?stock=low')).toEqual(['Beta Charger', 'Delta Hub']);
    expect(await titles('?stock=out')).toEqual(['Gamma Dock']);
    expect(await titles('?q=cable')).toEqual(['Alpha Cable']);
    const page = (await get('/seller/inventory?limit=2&page=3', seller)).body.data;
    expect(page).toMatchObject({ total: 5, totalPages: 3 });
    expect(page.items).toHaveLength(1);
    expect((await get('/seller/inventory?stock=plenty', seller)).status).toBe(422);
  });

  it('is private to sellers', async () => {
    expect((await get('/seller/inventory', customer)).status).toBe(403);
  });
});

describe('reviews on my products', () => {
  let p1;
  let pOther;
  beforeEach(async () => {
    p1 = await makeProduct(seller.user._id, category._id, { title: 'Mouse' });
    pOther = await makeProduct(other.user._id, category._id, { title: 'Other' });
    const a = customer.user;
    await makeReview({ product: p1, author: a, label: 'negative', text: 'Terrible battery life, very disappointed.' });
    await makeReview({ product: p1, author: a, label: 'positive', reply: 'Thank you!' });
    await makeReview({ product: p1, author: a, label: 'positive', status: 'flagged' });
    await makeReview({ product: pOther, author: a, label: 'negative' });
  });

  it('shows published reviews of my products only, with the product title', async () => {
    const { data } = (await get('/seller/reviews', seller)).body;
    expect(data.total).toBe(2);
    expect(data.items.every((r) => r.product.title === 'Mouse')).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/@example\.com/);
  });

  it('filters by sentiment and by whether I replied', async () => {
    const texts = async (query) => (await get(`/seller/reviews${query}`, seller)).body.data.items;
    expect((await texts('?sentiment=negative')).map((r) => r.sentiment.label)).toEqual(['negative']);
    const unreplied = await texts('?replied=false');
    expect(unreplied).toHaveLength(1);
    expect(unreplied[0].reply).toBeNull();
    expect((await texts('?replied=true'))[0].reply.text).toBe('Thank you!');
    expect(await texts(`?productId=${pOther._id}`)).toHaveLength(0); // not my product
    expect((await get('/seller/reviews?sentiment=angry', seller)).status).toBe(422);
  });
});
