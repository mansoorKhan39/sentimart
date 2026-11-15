import request from 'supertest';
import app from '../../src/app.js';
import { AuditLog } from '../../src/models/auditLog.model.js';
import { Order } from '../../src/models/order.model.js';
import { Product } from '../../src/models/product.model.js';
import { Review } from '../../src/models/review.model.js';
import { DAY, startOfUtcDay } from '../../src/utils/dates.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeReview, makeSale, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
const at = (daysAgo) => new Date(startOfUtcDay(new Date()).getTime() - daysAgo * DAY + 12 * 3_600_000);
const key = (daysAgo) => at(daysAgo).toISOString().slice(0, 10);

let mongod;
let admin;
let seller;
let customer;
let category;
const get = (path, who = admin) => request(app).get(api(path)).set(who.auth);
const patch = (path, body, who = admin) => request(app).patch(api(path)).set(who.auth).send(body);

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  admin = await makeUser({ role: 'admin' });
  seller = await makeUser({ role: 'seller' });
  customer = await makeUser();
  category = await makeCategory();
});

describe('product management', () => {
  let p1;
  let p2;
  beforeEach(async () => {
    p1 = await makeProduct(seller.user._id, category._id, { title: 'Wireless Mouse' });
    p2 = await makeProduct(seller.user._id, category._id, { title: 'Desk Lamp', status: 'hidden', hiddenReason: 'admin' });
  });

  it('lists every product (also hidden ones) with seller and filters', async () => {
    const all = (await get('/admin/products')).body.data;
    expect(all.total).toBe(2);
    expect(all.items[0].seller.businessName).toMatch(/^Shop/);
    expect((await get('/admin/products?status=hidden')).body.data.items.map((p) => p.title)).toEqual(['Desk Lamp']);
    expect((await get('/admin/products?q=mouse')).body.data.total).toBe(1);
    expect((await get(`/admin/products?sellerId=${seller.user._id}`)).body.data.total).toBe(2);
    expect((await get('/admin/products?status=gone')).status).toBe(422);
  });

  it('hides and restores a product for the public shop', async () => {
    const publicStatus = async () => (await request(app).get(api(`/products/${p1._id}`))).status;
    expect(await publicStatus()).toBe(200);
    const hidden = await patch(`/admin/products/${p1._id}/status`, { status: 'hidden' });
    expect(hidden.body.data.product).toMatchObject({ status: 'hidden', hiddenReason: 'admin' });
    expect(await publicStatus()).toBe(404);
    const shown = await patch(`/admin/products/${p1._id}/status`, { status: 'active' });
    expect(shown.body.data.product).toMatchObject({ status: 'active', hiddenReason: null });
    expect(await publicStatus()).toBe(200);
    expect((await patch('/admin/products/64b7f8f8f8f8f8f8f8f8f8f8/status', { status: 'hidden' })).status).toBe(404);
  });

  it('deletes a product and records it', async () => {
    expect((await request(app).delete(api(`/admin/products/${p1._id}`)).set(admin.auth)).status).toBe(200);
    expect(await Product.findById(p1._id)).toBeNull();
    expect((await request(app).delete(api(`/admin/products/${p1._id}`)).set(admin.auth)).status).toBe(404);
    expect((await AuditLog.findOne({ action: 'product.delete' })).meta.title).toBe('Wireless Mouse');
  });

  it('is not available to sellers (even for their own products)', async () => {
    expect((await patch(`/admin/products/${p1._id}/status`, { status: 'hidden' }, seller)).status).toBe(403);
  });
});

describe('flagged review queue (FR-31 to 33)', () => {
  let product;
  let flagged;
  beforeEach(async () => {
    product = await makeProduct(seller.user._id, category._id);
    flagged = await makeReview({
      product, author: customer.user, label: 'positive', rating: 5, status: 'flagged',
      spamScore: 0.9, spamReasons: ['duplicate_text'],
    });
  });
  const stats = async () => (await Product.findById(product._id)).toObject();

  it('shows what the admin needs to decide: text, score, reasons, author, product', async () => {
    const { data } = (await get('/admin/reviews/flagged')).body;
    expect(data.total).toBe(1);
    expect(data.items[0]).toMatchObject({
      spamScore: 0.9,
      spamReasons: ['duplicate_text'],
      author: { email: customer.user.email },
      product: { title: product.title },
    });
  });

  it('approving publishes it, counts it in the product numbers and keeps the decision', async () => {
    expect((await stats()).reviewCount).toBe(0);
    const res = await patch(`/admin/reviews/${flagged._id}/moderate`, { action: 'approve' });
    expect(res.body.data.review.status).toBe('published');
    expect((await stats()).reviewCount).toBe(1);
    expect((await stats()).avgRating).toBe(5);
    const saved = await Review.findById(flagged._id);
    expect(saved.moderatedAt).toBeTruthy();
    expect((await get('/admin/reviews/flagged')).body.data.total).toBe(0);
    expect((await request(app).get(api(`/products/${product._id}/reviews`))).body.data.items).toHaveLength(1);
  });

  it('removing hides it for good and recalculates', async () => {
    const published = await makeReview({ product, author: customer.user, label: 'positive', rating: 3 });
    await patch(`/admin/reviews/${flagged._id}/moderate`, { action: 'approve' });
    expect((await stats()).reviewCount).toBe(2);
    await patch(`/admin/reviews/${published._id}/moderate`, { action: 'remove' });
    expect((await stats()).reviewCount).toBe(1);
    expect((await Review.findById(published._id)).status).toBe('removed');
  });

  it('refuses impossible actions and bad input', async () => {
    const published = await makeReview({ product, author: customer.user, label: 'positive' });
    expect((await patch(`/admin/reviews/${published._id}/moderate`, { action: 'approve' })).body.error.code).toBe('NOT_FLAGGED');
    await patch(`/admin/reviews/${flagged._id}/moderate`, { action: 'remove' });
    expect((await patch(`/admin/reviews/${flagged._id}/moderate`, { action: 'remove' })).body.error.code).toBe('ALREADY_REMOVED');
    expect((await patch('/admin/reviews/64b7f8f8f8f8f8f8f8f8f8f8/moderate', { action: 'remove' })).status).toBe(404);
    expect((await patch(`/admin/reviews/${flagged._id}/moderate`, { action: 'delete' })).status).toBe(422);
    expect((await patch(`/admin/reviews/${flagged._id}/moderate`, { action: 'approve' }, seller)).status).toBe(403);
  });
});

describe('platform report (FR-39)', () => {
  it('summarises users, sales, orders and the review spam rate', async () => {
    await makeUser({ role: 'seller', approval: 'pending' });
    const mouse = await makeProduct(seller.user._id, category._id, { title: 'Mouse', price: 100000 });
    const pad = await makeProduct(seller.user._id, category._id, { title: 'Pad', price: 50000 });
    const sold = (lines, status, createdAt) => makeSale({ seller: seller.user, customer: customer.user, lines, status, createdAt });
    await sold([{ product: mouse, qty: 2 }], 'Delivered', at(2));
    await sold([{ product: pad }], 'Cancelled', at(2));
    await sold([{ product: pad }], 'Pending', at(1));
    const order = (total, createdAt) =>
      Order.create({ customerId: customer.user._id, address: { line1: '12 Test Street', city: 'Karachi' }, paymentMethod: 'COD', total, createdAt });
    await order(200000, at(2));
    await order(50000, at(1));
    await makeReview({ product: mouse, author: customer.user, label: 'positive', rating: 5 });
    await makeReview({ product: mouse, author: customer.user, label: 'positive', status: 'flagged' });
    await makeReview({ product: mouse, author: customer.user, label: 'negative', status: 'removed' });

    const { data } = (await get('/admin/reports')).body;
    expect(data.users).toMatchObject({ total: 4, byRole: { customer: 1, seller: 2, admin: 1 }, suspended: 0, newInRange: 4 });
    expect(data.sellers).toEqual({ pending: 1, approved: 1, rejected: 0 });
    expect(data.products).toEqual({ active: 2, hidden: 0 });
    expect(data.sales).toMatchObject({ revenue: 250000, orders: 2, avgOrderValue: 125000 });
    expect(data.sales.byStatus).toEqual({ Pending: 1, Confirmed: 0, Shipped: 0, Delivered: 1, Cancelled: 1 });
    expect(data.sales.series).toHaveLength(30);
    expect(data.sales.series.find((d) => d.date === key(2))).toEqual({ date: key(2), revenue: 200000, orders: 1 });
    expect(data.sales.series.find((d) => d.date === key(1))).toEqual({ date: key(1), revenue: 50000, orders: 1 });
    expect(data.reviews).toMatchObject({ published: 1, flagged: 1, removed: 1, total: 3, flaggedRate: 66.7, avgRating: 5 });
    expect(data.reviews.sentiment).toEqual({ positive: 1, neutral: 0, negative: 0 });
    expect(data.topSellers[0]).toMatchObject({ revenue: 250000, orders: 2 });
    expect(data.topSellers[0].businessName).toMatch(/^Shop/);
    expect(data.topProducts[0]).toMatchObject({ title: 'Mouse', units: 2, revenue: 200000 });
    expect(data.queues).toEqual({ pendingSellers: 1, flaggedReviews: 1 });
  });

  it('accepts a range, rejects bad ones, and is admin only', async () => {
    expect((await get('/admin/reports?range=7d')).body.data.sales.series).toHaveLength(7);
    expect((await get('/admin/reports?range=2y')).status).toBe(422);
    expect((await get('/admin/reports', seller)).status).toBe(403);
    expect((await request(app).get(api('/admin/reports'))).status).toBe(401);
  });
});

describe('audit log (FR-40)', () => {
  it('records who did what, newest first, and can be filtered', async () => {
    const target = await makeProduct(seller.user._id, category._id, { title: 'Audited' });
    await patch(`/admin/products/${target._id}/status`, { status: 'hidden' });
    await patch(`/admin/users/${customer.user._id}/status`, { status: 'suspended' });

    const { data } = (await get('/admin/audit-log')).body;
    expect(data.total).toBe(2);
    expect(data.items[0]).toMatchObject({ action: 'user.status', actor: { email: admin.user.email }, targetType: 'user' });
    expect(data.items[1]).toMatchObject({ action: 'product.status', meta: { status: 'hidden' } });
    const only = (await get('/admin/audit-log?action=product.status')).body.data;
    expect(only.items.map((i) => i.action)).toEqual(['product.status']);
    expect((await get('/admin/audit-log', seller)).status).toBe(403);
  });
});
