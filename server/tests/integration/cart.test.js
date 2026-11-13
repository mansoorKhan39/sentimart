import request from 'supertest';
import app from '../../src/app.js';
import { Cart } from '../../src/models/cart.model.js';
import { Product } from '../../src/models/product.model.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
let mongod;
let customer;
let sellerA;
let sellerB;
let mouse;
let keyboard;
let book;

const put = (productId, qty, who = customer) =>
  request(app).put(api(`/cart/items/${productId}`)).set(who.auth).send({ qty });
const getCart = (who = customer) => request(app).get(api('/cart')).set(who.auth);

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  customer = await makeUser();
  sellerA = await makeUser({ role: 'seller' });
  sellerB = await makeUser({ role: 'seller' });
  const category = await makeCategory();
  mouse = await makeProduct(sellerA.user._id, category._id, { title: 'Mouse', price: 100000, stock: 5 });
  keyboard = await makeProduct(sellerA.user._id, category._id, { title: 'Keyboard', price: 250000, stock: 3 });
  book = await makeProduct(sellerB.user._id, category._id, { title: 'Book', price: 50000, stock: 10 });
});

describe('cart access', () => {
  it('requires a logged-in customer', async () => {
    expect((await request(app).get(api('/cart'))).status).toBe(401);
    expect((await getCart(sellerA)).status).toBe(403);
  });

  it('starts empty', async () => {
    const res = await getCart();
    expect(res.status).toBe(200);
    expect(res.body.data.cart).toMatchObject({ items: [], groups: [], itemCount: 0, total: 0 });
  });
});

describe('add and change quantity (AC-CART)', () => {
  it('adds an item and calculates totals in minor units', async () => {
    const res = await put(mouse._id, 2);
    expect(res.status).toBe(200);
    expect(res.body.data.cart.total).toBe(200000);
    expect(res.body.data.cart.itemCount).toBe(2);
    expect(res.body.data.cart.items[0]).toMatchObject({ title: 'Mouse', qty: 2, unitPrice: 100000, lineTotal: 200000 });
  });

  it('sets the quantity (replaces, does not add up)', async () => {
    await put(mouse._id, 2);
    const res = await put(mouse._id, 4);
    expect(res.body.data.cart.items).toHaveLength(1);
    expect(res.body.data.cart.items[0].qty).toBe(4);
  });

  it('refuses more than the available stock and leaves the cart unchanged', async () => {
    await put(mouse._id, 2);
    const res = await put(mouse._id, 6);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details.available).toBe(5);
    expect((await getCart()).body.data.cart.items[0].qty).toBe(2);
  });

  it('rejects unknown and hidden products', async () => {
    await Product.updateOne({ _id: keyboard._id }, { status: 'hidden' });
    expect((await put(keyboard._id, 1)).status).toBe(404);
    expect((await put('64b7f8f8f8f8f8f8f8f8f8f8', 1)).status).toBe(404);
  });

  it('validates quantity and id', async () => {
    expect((await put(mouse._id, 0)).status).toBe(422);
    expect((await put(mouse._id, 1.5)).status).toBe(422);
    expect((await put(mouse._id, 100)).status).toBe(422);
    expect((await put('not-an-id', 1)).status).toBe(422);
  });

  it('keeps one line when the same new item is added in parallel', async () => {
    await Promise.all(Array.from({ length: 6 }, () => put(mouse._id, 3)));
    const cart = await Cart.findOne({ userId: customer.user._id });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].qty).toBe(3);
  });

  it('keeps both lines when two different items are added in parallel', async () => {
    await Promise.all([put(mouse._id, 1), put(keyboard._id, 1), put(book._id, 1)]);
    const cart = await Cart.findOne({ userId: customer.user._id });
    expect(cart.items).toHaveLength(3);
  });

  it('persists across requests and is private to each customer', async () => {
    await put(mouse._id, 1);
    const other = await makeUser();
    expect((await getCart()).body.data.cart.items).toHaveLength(1);
    expect((await getCart(other)).body.data.cart.items).toHaveLength(0);
  });
});

describe('multi-seller grouping and availability', () => {
  it('groups lines per seller with subtotals', async () => {
    await put(mouse._id, 1);
    await put(keyboard._id, 2);
    await put(book._id, 3);
    const { groups, total } = (await getCart()).body.data.cart;
    expect(groups).toHaveLength(2);
    const a = groups.find((g) => g.sellerId === String(sellerA.user._id));
    const b = groups.find((g) => g.sellerId === String(sellerB.user._id));
    expect(a.subtotal).toBe(100000 + 2 * 250000);
    expect(a.businessName).toMatch(/^Shop/);
    expect(b.subtotal).toBe(150000);
    expect(total).toBe(a.subtotal + b.subtotal);
  });

  it('flags items that became unavailable and leaves them out of the total', async () => {
    await put(mouse._id, 3);
    await put(book._id, 1);
    await Product.updateOne({ _id: mouse._id }, { stock: 1 });
    const { cart } = (await getCart()).body.data;
    const line = cart.items.find((i) => i.title === 'Mouse');
    expect(line.available).toBe(false);
    expect(cart.hasUnavailable).toBe(true);
    expect(cart.total).toBe(50000);
    expect(cart.itemCount).toBe(1);
  });

  it('silently drops products that were deleted', async () => {
    await put(mouse._id, 1);
    await put(book._id, 1);
    await Product.deleteOne({ _id: mouse._id });
    const { cart } = (await getCart()).body.data;
    expect(cart.items.map((i) => i.title)).toEqual(['Book']);
  });
});

describe('remove and clear', () => {
  it('removes one item', async () => {
    await put(mouse._id, 1);
    await put(book._id, 1);
    const res = await request(app).delete(api(`/cart/items/${mouse._id}`)).set(customer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.cart.items.map((i) => i.title)).toEqual(['Book']);
  });

  it('clears the cart', async () => {
    await put(mouse._id, 1);
    const res = await request(app).delete(api('/cart')).set(customer.auth);
    expect(res.body.data.cart.items).toHaveLength(0);
    expect(res.body.data.cart.total).toBe(0);
  });
});

describe('wishlist', () => {
  const add = (id, who = customer) => request(app).post(api(`/wishlist/${id}`)).set(who.auth);

  it('requires a customer', async () => {
    expect((await request(app).get(api('/wishlist'))).status).toBe(401);
    expect((await request(app).get(api('/wishlist')).set(sellerA.auth)).status).toBe(403);
  });

  it('adds idempotently and lists products in the order they were saved', async () => {
    expect((await add(book._id)).status).toBe(201);
    await add(mouse._id);
    const again = await add(book._id);
    expect(again.body.data.wishlist).toHaveLength(2);
    const list = await request(app).get(api('/wishlist')).set(customer.auth);
    expect(list.body.data.products.map((p) => p.title)).toEqual(['Book', 'Mouse']);
  });

  it('removes items and rejects unknown products', async () => {
    await add(book._id);
    const res = await request(app).delete(api(`/wishlist/${book._id}`)).set(customer.auth);
    expect(res.body.data.wishlist).toHaveLength(0);
    expect((await add('64b7f8f8f8f8f8f8f8f8f8f8')).status).toBe(404);
  });

  it('hides products that are no longer active', async () => {
    await add(book._id);
    await add(mouse._id);
    await Product.updateOne({ _id: book._id }, { status: 'hidden' });
    const list = await request(app).get(api('/wishlist')).set(customer.auth);
    expect(list.body.data.products.map((p) => p.title)).toEqual(['Mouse']);
  });
});
