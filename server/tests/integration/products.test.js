import request from 'supertest';
import app from '../../src/app.js';
import { Product } from '../../src/models/product.model.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeUser, productData, validProductBody } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
let mongod;

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));
beforeEach(clearDb);

describe('create product (AC-PROD)', () => {
  it('lets an approved seller create a product and hides seller contact details', async () => {
    const seller = await makeUser({ role: 'seller' });
    const category = await makeCategory();
    const res = await request(app).post(api('/products')).set(seller.auth).send(validProductBody(category._id));
    expect(res.status).toBe(201);
    const { product } = res.body.data;
    expect(product.price).toBe(249900);
    expect(product.seller.businessName).toMatch(/^Shop/);
    expect(product.category.slug).toBe('electronics');
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|passwordHash|publicId/);
  });

  it('blocks pending sellers, customers and anonymous users', async () => {
    const category = await makeCategory();
    const body = validProductBody(category._id);
    const pending = await makeUser({ role: 'seller', approval: 'pending' });
    const customer = await makeUser();
    const res = await request(app).post(api('/products')).set(pending.auth).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELLER_NOT_APPROVED');
    expect((await request(app).post(api('/products')).set(customer.auth).send(body)).status).toBe(403);
    expect((await request(app).post(api('/products')).send(body)).status).toBe(401);
  });

  it('rejects invalid prices, stock and unknown fields (mass assignment)', async () => {
    const seller = await makeUser({ role: 'seller' });
    const category = await makeCategory();
    const post = (extra) => request(app).post(api('/products')).set(seller.auth).send(validProductBody(category._id, extra));
    expect((await post({ price: 12.5 })).status).toBe(422);
    expect((await post({ price: -1 })).status).toBe(422);
    expect((await post({ price: '100' })).status).toBe(422);
    expect((await post({ stock: -5 })).status).toBe(422);
    expect((await post({ sellerId: String(category._id) })).status).toBe(422);
    expect((await post({ status: 'hidden' })).status).toBe(422);
  });

  it('returns 404 for an unknown category', async () => {
    const seller = await makeUser({ role: 'seller' });
    const category = await makeCategory();
    await category.deleteOne();
    const res = await request(app).post(api('/products')).set(seller.auth).send(validProductBody(category._id));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });
});

describe('read and list products', () => {
  let seller;
  let audio;
  let books;

  beforeEach(async () => {
    seller = await makeUser({ role: 'seller' });
    audio = await makeCategory('Audio');
    books = await makeCategory('Books');
  });

  it('is public, and hidden products never appear', async () => {
    const visible = await makeProduct(seller.user._id, audio._id, { title: 'Visible Speaker' });
    const hidden = await makeProduct(seller.user._id, audio._id, { title: 'Hidden Speaker', status: 'hidden' });
    const list = await request(app).get(api('/products'));
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((p) => p.title)).toEqual(['Visible Speaker']);
    expect((await request(app).get(api(`/products/${visible._id}`))).status).toBe(200);
    expect((await request(app).get(api(`/products/${hidden._id}`))).status).toBe(404);
  });

  it('validates the id (422) and returns 404 for unknown ids', async () => {
    expect((await request(app).get(api('/products/not-an-id'))).status).toBe(422);
    expect((await request(app).get(api('/products/64b7f8f8f8f8f8f8f8f8f8f8'))).status).toBe(404);
  });

  it('searches partial words case-insensitively and treats input as text, not regex', async () => {
    await makeProduct(seller.user._id, audio._id, { title: 'Wireless Mouse' });
    await makeProduct(seller.user._id, books._id, { title: 'Clean Code' });
    const hit = await request(app).get(api('/products?q=mOU'));
    expect(hit.body.data.items.map((p) => p.title)).toEqual(['Wireless Mouse']);
    expect((await request(app).get(api('/products?q=.*'))).body.data.total).toBe(0);
    expect((await request(app).get(api('/products?q=('))).status).toBe(200);
  });

  it('filters by category slug; an unknown slug gives an empty page', async () => {
    await makeProduct(seller.user._id, audio._id);
    await makeProduct(seller.user._id, books._id);
    const res = await request(app).get(api('/products?category=books'));
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].category.slug).toBe('books');
    expect((await request(app).get(api('/products?category=nope'))).body.data.total).toBe(0);
  });

  it('filters by price range and sorts by price', async () => {
    await makeProduct(seller.user._id, audio._id, { title: 'Cheap', price: 10000 });
    await makeProduct(seller.user._id, audio._id, { title: 'Middle', price: 50000 });
    await makeProduct(seller.user._id, audio._id, { title: 'Pricey', price: 90000 });
    const range = await request(app).get(api('/products?minPrice=20000&maxPrice=95000&sort=price_asc'));
    expect(range.body.data.items.map((p) => p.title)).toEqual(['Middle', 'Pricey']);
    const desc = await request(app).get(api('/products?sort=price_desc'));
    expect(desc.body.data.items.map((p) => p.title)).toEqual(['Pricey', 'Middle', 'Cheap']);
    expect((await request(app).get(api('/products?minPrice=9&maxPrice=1'))).status).toBe(422);
  });

  it('filters by minimum rating and by sentiment', async () => {
    await makeProduct(seller.user._id, audio._id, {
      title: 'Loved', avgRating: 4.8, reviewCount: 5, sentiment: { avgScore: 0.6 },
    });
    await makeProduct(seller.user._id, audio._id, {
      title: 'Disliked', avgRating: 2, reviewCount: 4, sentiment: { avgScore: -0.5 },
    });
    await makeProduct(seller.user._id, audio._id, { title: 'Unreviewed' });
    const rated = await request(app).get(api('/products?minRating=4'));
    expect(rated.body.data.items.map((p) => p.title)).toEqual(['Loved']);
    const positive = await request(app).get(api('/products?sentiment=positive'));
    expect(positive.body.data.items.map((p) => p.title)).toEqual(['Loved']);
    const negative = await request(app).get(api('/products?sentiment=negative'));
    expect(negative.body.data.items.map((p) => p.title)).toEqual(['Disliked']);
    const neutral = await request(app).get(api('/products?sentiment=neutral'));
    expect(neutral.body.data.total).toBe(0); // unreviewed products are not "neutral"
  });

  it('paginates and caps the page size at 50', async () => {
    await Product.insertMany(Array.from({ length: 55 }, () => productData(seller.user._id, audio._id)));
    const first = await request(app).get(api('/products?limit=999'));
    expect(first.body.data.limit).toBe(50);
    expect(first.body.data.items).toHaveLength(50);
    expect(first.body.data.total).toBe(55);
    expect(first.body.data.totalPages).toBe(2);
    const second = await request(app).get(api('/products?limit=999&page=2'));
    expect(second.body.data.items).toHaveLength(5);
  });
});

describe('update and delete (ownership)', () => {
  it('lets the owner update; other sellers and customers get 403', async () => {
    const owner = await makeUser({ role: 'seller' });
    const other = await makeUser({ role: 'seller' });
    const customer = await makeUser();
    const category = await makeCategory();
    const product = await makeProduct(owner.user._id, category._id);
    const url = api(`/products/${product._id}`);

    const ok = await request(app).patch(url).set(owner.auth).send({ price: 200000, stock: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.product.price).toBe(200000);
    expect((await request(app).patch(url).set(other.auth).send({ price: 1 })).status).toBe(403);
    expect((await request(app).patch(url).set(customer.auth).send({ price: 1 })).status).toBe(403);
    expect((await request(app).patch(url).set(owner.auth).send({})).status).toBe(422);
    expect((await Product.findById(product._id)).price).toBe(200000);
  });

  it('lets only the owner delete', async () => {
    const owner = await makeUser({ role: 'seller' });
    const other = await makeUser({ role: 'seller' });
    const category = await makeCategory();
    const product = await makeProduct(owner.user._id, category._id);
    const url = api(`/products/${product._id}`);

    expect((await request(app).delete(url).set(other.auth)).status).toBe(403);
    expect((await request(app).delete(url).set(owner.auth)).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(404);
  });
});
