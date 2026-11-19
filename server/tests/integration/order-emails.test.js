import { jest } from '@jest/globals';
import request from 'supertest';

// Turn real email sending on for THIS file only (before the app is imported); fetch is mocked.
process.env.EMAIL_PROVIDER = 'brevo';
process.env.EMAIL_API_KEY = 'test-key';
const { default: app } = await import('../../src/app.js');
const { Cart } = await import('../../src/models/cart.model.js');
const { clearDb, closeTestDb, connectTestDb, initModels } = await import('../helpers/db.js');
const { makeCategory, makeProduct, makeUser } = await import('../helpers/factories.js');

const api = (path) => `/api/v1${path}`;
const ADDRESS = { line1: '12 Street, Sector F-7', city: 'Islamabad' };
let mongod;
let customer;
let sellerA;
let sellerB;
let mouse;
let book;
const realFetch = global.fetch;

const sent = () =>
  global.fetch.mock.calls.map(([url, init]) => ({ url, init, body: JSON.parse(init.body) }));
const checkout = () =>
  request(app)
    .post(api('/orders'))
    .set(customer.auth)
    .send({ address: ADDRESS, paymentMethod: 'COD' });

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(async () => {
  global.fetch = realFetch;
  await closeTestDb(mongod);
});
beforeEach(async () => {
  await clearDb();
  global.fetch = jest.fn(async () => ({ ok: true, status: 201 }));
  customer = await makeUser();
  sellerA = await makeUser({ role: 'seller' });
  sellerB = await makeUser({ role: 'seller' });
  const category = await makeCategory();
  mouse = await makeProduct(sellerA.user._id, category._id, {
    title: 'Mouse',
    price: 100000,
    stock: 5,
  });
  book = await makeProduct(sellerB.user._id, category._id, {
    title: 'Book',
    price: 50000,
    stock: 5,
  });
  await Cart.create({
    userId: customer.user._id,
    items: [
      { productId: mouse._id, qty: 1 },
      { productId: book._id, qty: 1 },
    ],
  });
});

describe('order emails (AC-NOTIFY)', () => {
  it('emails the customer and each seller after checkout', async () => {
    const res = await checkout();
    expect(res.status).toBe(201);
    const mails = sent();
    expect(mails).toHaveLength(3);
    expect(mails.every((m) => m.url === 'https://api.brevo.com/v3/smtp/email')).toBe(true);
    expect(mails.every((m) => m.init.headers['api-key'] === 'test-key')).toBe(true);
    const to = mails.map((m) => m.body.to[0].email).sort();
    expect(to).toEqual([customer.user.email, sellerA.user.email, sellerB.user.email].sort());
    expect(mails.find((m) => m.body.to[0].email === customer.user.email).body.subject).toMatch(
      /order confirmed/i,
    );
  });

  it('still places the order when the email provider is down (TC-17)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    expect((await checkout()).status).toBe(201);
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await Cart.updateOne(
      { userId: customer.user._id },
      { items: [{ productId: mouse._id, qty: 1 }] },
    );
    expect((await checkout()).status).toBe(201);
  });

  it('emails the customer when the seller changes the status', async () => {
    const { order } = (await checkout()).body.data;
    global.fetch.mockClear();
    const subId = order.subOrders.find((s) => s.sellerId === String(sellerA.user._id)).id;
    const res = await request(app)
      .patch(api(`/seller/sub-orders/${subId}/status`))
      .set(sellerA.auth)
      .send({ status: 'Confirmed' });
    expect(res.status).toBe(200);
    const mails = sent();
    expect(mails).toHaveLength(1);
    expect(mails[0].body.to[0].email).toBe(customer.user.email);
    expect(mails[0].body.subject).toBe('Your order is now Confirmed');
  });
});
