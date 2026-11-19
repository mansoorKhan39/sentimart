import request from 'supertest';
import app from '../../src/app.js';
import { Cart } from '../../src/models/cart.model.js';
import { Order } from '../../src/models/order.model.js';
import { Product } from '../../src/models/product.model.js';
import { SubOrder } from '../../src/models/subOrder.model.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
const ADDRESS = { line1: '12 Street, Sector F-7', city: 'Islamabad', phone: '0300 1234567' };
let mongod;
let customer;
let other;
let sellerA;
let sellerB;
let mouse;
let keyboard;
let book;

const fillCart = (who, lines) =>
  Cart.create({
    userId: who.user._id,
    items: lines.map(([p, qty]) => ({ productId: p._id, qty })),
  });
const checkout = (who = customer, body = { address: ADDRESS, paymentMethod: 'COD' }) =>
  request(app).post(api('/orders')).set(who.auth).send(body);
const stockOf = async (p) => (await Product.findById(p._id)).stock;

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  customer = await makeUser();
  other = await makeUser();
  sellerA = await makeUser({ role: 'seller' });
  sellerB = await makeUser({ role: 'seller' });
  const category = await makeCategory();
  mouse = await makeProduct(sellerA.user._id, category._id, {
    title: 'Mouse',
    price: 100000,
    stock: 5,
  });
  keyboard = await makeProduct(sellerA.user._id, category._id, {
    title: 'Keyboard',
    price: 250000,
    stock: 3,
  });
  book = await makeProduct(sellerB.user._id, category._id, {
    title: 'Book',
    price: 50000,
    stock: 10,
  });
});

describe('checkout', () => {
  it('requires a logged-in customer', async () => {
    expect((await request(app).post(api('/orders')).send({})).status).toBe(401);
    expect((await checkout(sellerA)).status).toBe(403);
  });

  it('splits a two-seller cart into two sub-orders, reduces stock and clears the cart (TC-09)', async () => {
    await fillCart(customer, [
      [mouse, 2],
      [keyboard, 1],
      [book, 3],
    ]);
    const res = await checkout();

    expect(res.status).toBe(201);
    const { order } = res.body.data;
    expect(order.total).toBe(2 * 100000 + 250000 + 3 * 50000);
    expect(order.status).toBe('Pending');
    expect(order.subOrders).toHaveLength(2);
    const a = order.subOrders.find((s) => s.sellerId === String(sellerA.user._id));
    const b = order.subOrders.find((s) => s.sellerId === String(sellerB.user._id));
    expect(a.subtotal).toBe(450000);
    expect(a.items).toHaveLength(2);
    expect(b.subtotal).toBe(150000);
    expect(b.statusHistory).toHaveLength(1);

    expect(await stockOf(mouse)).toBe(3);
    expect(await stockOf(keyboard)).toBe(2);
    expect(await stockOf(book)).toBe(7);
    expect((await Cart.findOne({ userId: customer.user._id })).items).toHaveLength(0);
  });

  it('rejects an empty cart', async () => {
    const res = await checkout();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CART_EMPTY');
  });

  it('is all-or-nothing: one item out of stock changes nothing (AC-ORDER)', async () => {
    await fillCart(customer, [
      [mouse, 2],
      [book, 3],
    ]);
    await Product.updateOne({ _id: book._id }, { stock: 1 }); // stock drops after it was put in the cart
    const res = await checkout();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    expect(res.body.error.details).toMatchObject({ available: 1 });
    expect(await stockOf(mouse)).toBe(5); // the first item was NOT kept decremented
    expect(await stockOf(book)).toBe(1);
    expect(await Order.countDocuments()).toBe(0);
    expect(await SubOrder.countDocuments()).toBe(0);
    expect((await Cart.findOne({ userId: customer.user._id })).items).toHaveLength(2);
  });

  it('refuses hidden products', async () => {
    await fillCart(customer, [[mouse, 1]]);
    await Product.updateOne({ _id: mouse._id }, { status: 'hidden' });
    const res = await checkout();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(await stockOf(mouse)).toBe(5);
  });

  it('sells the last unit to only one of two simultaneous buyers (TC-08)', async () => {
    await Product.updateOne({ _id: mouse._id }, { stock: 1 });
    await fillCart(customer, [[mouse, 1]]);
    await fillCart(other, [[mouse, 1]]);
    const [r1, r2] = await Promise.all([checkout(customer), checkout(other)]);

    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await stockOf(mouse)).toBe(0); // never negative
    expect(await Order.countDocuments()).toBe(1);
  });

  it('keeps the purchase-time price when the seller changes it later', async () => {
    await fillCart(customer, [[mouse, 1]]);
    const { body } = await checkout();
    await Product.updateOne({ _id: mouse._id }, { price: 999999, title: 'Renamed' });
    const res = await request(app)
      .get(api(`/orders/${body.data.order.id}`))
      .set(customer.auth);
    expect(res.body.data.order.subOrders[0].items[0]).toMatchObject({
      price: 100000,
      title: 'Mouse',
    });
  });

  it('validates the body and never accepts card data', async () => {
    await fillCart(customer, [[mouse, 1]]);
    const bad = [
      { paymentMethod: 'COD' },
      { address: { line1: 'x', city: 'I' }, paymentMethod: 'COD' },
      { address: ADDRESS, paymentMethod: 'BITCOIN' },
      { address: ADDRESS, paymentMethod: 'TEST_CARD', cardNumber: '4242424242424242' },
    ];
    for (const body of bad) expect((await checkout(customer, body)).status).toBe(422);
    expect(await Order.countDocuments()).toBe(0);
    expect(
      (await checkout(customer, { address: ADDRESS, paymentMethod: 'TEST_CARD' })).status,
    ).toBe(201);
  });
});

describe('order history', () => {
  it("lists only my orders and hides other people's orders behind 404", async () => {
    await fillCart(customer, [[mouse, 1]]);
    const mine = (await checkout(customer)).body.data.order;
    await fillCart(other, [[book, 1]]);
    await checkout(other);

    const list = await request(app).get(api('/orders')).set(customer.auth);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0].id).toBe(mine.id);
    expect(list.body.data.items[0].subOrders[0].sellerName).toMatch(/Shop/);

    expect(
      (
        await request(app)
          .get(api(`/orders/${mine.id}`))
          .set(other.auth)
      ).status,
    ).toBe(404);
    expect((await request(app).get(api('/orders/not-an-id')).set(customer.auth)).status).toBe(422);
  });
});

describe('customer cancel', () => {
  let subId;
  beforeEach(async () => {
    await fillCart(customer, [
      [mouse, 2],
      [book, 1],
    ]);
    const { order } = (await checkout()).body.data;
    subId = order.subOrders.find((s) => s.sellerId === String(sellerA.user._id)).id;
  });
  const cancel = (id, who = customer) =>
    request(app)
      .patch(api(`/sub-orders/${id}/cancel`))
      .set(who.auth);

  it('cancels before shipping and restores stock exactly once (TC-10)', async () => {
    expect(await stockOf(mouse)).toBe(3);
    const res = await cancel(subId);
    expect(res.status).toBe(200);
    expect(res.body.data.subOrder.status).toBe('Cancelled');
    expect(await stockOf(mouse)).toBe(5);

    const again = await cancel(subId);
    expect(again.status).toBe(409);
    expect(await stockOf(mouse)).toBe(5); // no double restore
    expect(await stockOf(book)).toBe(9); // the other seller's package is untouched
  });

  it('blocks cancelling once shipped', async () => {
    await SubOrder.updateOne({ _id: subId }, { status: 'Shipped' });
    const res = await cancel(subId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(await stockOf(mouse)).toBe(3);
  });

  it('does not let another customer cancel it', async () => {
    expect((await cancel(subId, other)).status).toBe(404);
    expect((await cancel(subId, sellerA)).status).toBe(403);
  });

  it('shows Cancelled for the order only when every package is cancelled', async () => {
    const list = (await request(app).get(api('/orders')).set(customer.auth)).body.data.items[0];
    await cancel(subId);
    const half = (
      await request(app)
        .get(api(`/orders/${list.id}`))
        .set(customer.auth)
    ).body.data.order;
    expect(half.status).toBe('Pending'); // the book package is still alive
    await cancel(list.subOrders.find((s) => s.id !== subId).id);
    const all = (
      await request(app)
        .get(api(`/orders/${list.id}`))
        .set(customer.auth)
    ).body.data.order;
    expect(all.status).toBe('Cancelled');
  });
});

describe('seller fulfilment', () => {
  let subA;
  beforeEach(async () => {
    await fillCart(customer, [
      [mouse, 1],
      [book, 1],
    ]);
    const { order } = (await checkout()).body.data;
    subA = order.subOrders.find((s) => s.sellerId === String(sellerA.user._id)).id;
  });
  const setStatus = (id, status, who = sellerA) =>
    request(app)
      .patch(api(`/seller/sub-orders/${id}/status`))
      .set(who.auth)
      .send({ status });

  it("lists only the seller's own packages, with the shipping address", async () => {
    const res = await request(app).get(api('/seller/sub-orders')).set(sellerA.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({
      id: subA,
      shipTo: { city: 'Islamabad' },
      paymentMethod: 'COD',
    });
    expect(res.body.data.items[0].customerName).toMatch(/Test customer/);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/); // no customer email leaks to the seller

    const filtered = await request(app)
      .get(api('/seller/sub-orders?status=Shipped'))
      .set(sellerA.auth);
    expect(filtered.body.data.total).toBe(0);
    expect((await request(app).get(api('/seller/sub-orders')).set(customer.auth)).status).toBe(403);
  });

  it('moves forward one step at a time: Pending, Confirmed, Shipped, Delivered', async () => {
    expect((await setStatus(subA, 'Shipped')).status).toBe(409); // cannot skip Confirmed
    for (const status of ['Confirmed', 'Shipped', 'Delivered']) {
      const res = await setStatus(subA, status);
      expect(res.status).toBe(200);
      expect(res.body.data.subOrder.status).toBe(status);
    }
    const history = (await SubOrder.findById(subA)).statusHistory.map((h) => h.status);
    expect(history).toEqual(['Pending', 'Confirmed', 'Shipped', 'Delivered']);
    expect((await setStatus(subA, 'Confirmed')).status).toBe(409); // never backward
  });

  it("customer sees the seller's progress in order tracking", async () => {
    await setStatus(subA, 'Confirmed');
    const orders = (await request(app).get(api('/orders')).set(customer.auth)).body.data.items;
    const sub = orders[0].subOrders.find((s) => s.id === subA);
    expect(sub.status).toBe('Confirmed');
    expect(orders[0].status).toBe('Pending'); // the other package is still Pending
  });

  it("cannot touch another seller's package or set a status like Cancelled", async () => {
    expect((await setStatus(subA, 'Confirmed', sellerB)).status).toBe(404);
    expect((await setStatus(subA, 'Cancelled')).status).toBe(422);
    expect((await setStatus(subA, 'Confirmed', customer)).status).toBe(403);
  });

  it('cannot confirm a package the customer already cancelled', async () => {
    await request(app)
      .patch(api(`/sub-orders/${subA}/cancel`))
      .set(customer.auth);
    const res = await setStatus(subA, 'Confirmed');
    expect(res.status).toBe(409);
    expect((await SubOrder.findById(subA)).status).toBe('Cancelled');
  });
});
