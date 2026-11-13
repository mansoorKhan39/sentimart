import request from 'supertest';
import app from '../../src/app.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
let mongod;

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));
beforeEach(clearDb);

describe('categories', () => {
  it('lists categories publicly, sorted by name', async () => {
    await makeCategory('Books');
    await makeCategory('Audio');
    const res = await request(app).get(api('/categories'));
    expect(res.status).toBe(200);
    expect(res.body.data.categories.map((c) => c.name)).toEqual(['Audio', 'Books']);
  });

  it('lets an admin create a category and generates the slug', async () => {
    const { auth } = await makeUser({ role: 'admin' });
    const res = await request(app).post(api('/categories')).set(auth).send({ name: 'Home & Kitchen' });
    expect(res.status).toBe(201);
    expect(res.body.data.category.slug).toBe('home-kitchen');
  });

  it('blocks anonymous users, customers and sellers from creating categories', async () => {
    const customer = await makeUser();
    const seller = await makeUser({ role: 'seller' });
    expect((await request(app).post(api('/categories')).send({ name: 'X Y' })).status).toBe(401);
    expect((await request(app).post(api('/categories')).set(customer.auth).send({ name: 'X Y' })).status).toBe(403);
    expect((await request(app).post(api('/categories')).set(seller.auth).send({ name: 'X Y' })).status).toBe(403);
  });

  it('rejects duplicates (409) and names without letters or digits (422)', async () => {
    const { auth } = await makeUser({ role: 'admin' });
    await request(app).post(api('/categories')).set(auth).send({ name: 'Books' });
    const dup = await request(app).post(api('/categories')).set(auth).send({ name: 'Books' });
    expect(dup.status).toBe(409);
    const empty = await request(app).post(api('/categories')).set(auth).send({ name: '!!!' });
    expect(empty.status).toBe(422);
  });

  it('renames a category and updates its slug', async () => {
    const { auth } = await makeUser({ role: 'admin' });
    const category = await makeCategory('Boks');
    const res = await request(app).patch(api(`/categories/${category._id}`)).set(auth).send({ name: 'Books' });
    expect(res.status).toBe(200);
    expect(res.body.data.category.slug).toBe('books');
  });

  it('refuses to delete a category that still has products, then allows it when empty', async () => {
    const { auth } = await makeUser({ role: 'admin' });
    const seller = await makeUser({ role: 'seller' });
    const category = await makeCategory('Books');
    const product = await makeProduct(seller.user._id, category._id);

    const blocked = await request(app).delete(api(`/categories/${category._id}`)).set(auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');

    await product.deleteOne();
    expect((await request(app).delete(api(`/categories/${category._id}`)).set(auth)).status).toBe(200);
  });
});
