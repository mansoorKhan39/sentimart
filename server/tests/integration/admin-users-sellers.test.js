import request from 'supertest';
import app from '../../src/app.js';
import { AuditLog } from '../../src/models/auditLog.model.js';
import { Product } from '../../src/models/product.model.js';
import { RefreshToken } from '../../src/models/refreshToken.model.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeUser, validProductBody } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
const as = (who) => ({
  get: (path) => request(app).get(api(path)).set(who.auth),
  patch: (path, body) => request(app).patch(api(path)).set(who.auth).send(body),
});

let mongod;
let admin;
let customer1;
let customer2;
let sellerPending;
let sellerOk;
let category;
let boss;

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  admin = await makeUser({ role: 'admin' });
  customer1 = await makeUser();
  customer2 = await makeUser();
  sellerPending = await makeUser({ role: 'seller', approval: 'pending' });
  sellerOk = await makeUser({ role: 'seller' });
  category = await makeCategory();
  boss = as(admin);
});

const visibleTitles = async () =>
  (await request(app).get(api('/products?limit=50'))).body.data.items.map((p) => p.title);

describe('admin access', () => {
  it('is for admins only', async () => {
    expect((await request(app).get(api('/admin/users'))).status).toBe(401);
    expect((await as(customer1).get('/admin/users')).status).toBe(403);
    expect((await as(sellerOk).get('/admin/users')).status).toBe(403);
    expect((await as(sellerOk).patch(`/admin/users/${customer1.user._id}/status`, { status: 'suspended' })).status).toBe(403);
  });
});

describe('users', () => {
  it('lists, filters, searches and paginates', async () => {
    const all = (await boss.get('/admin/users')).body.data;
    expect(all.total).toBe(5);
    expect(all.items[0]).toHaveProperty('email'); // admins may see emails
    expect((await boss.get('/admin/users?role=seller')).body.data.total).toBe(2);
    expect((await boss.get('/admin/users?status=suspended')).body.data.total).toBe(0);
    expect((await boss.get('/admin/users?q=customer')).body.data.total).toBe(2);
    expect((await boss.get('/admin/users?limit=2&page=3')).body.data.items).toHaveLength(1);
    expect((await boss.get('/admin/users?role=king')).status).toBe(422);
  });

  it('suspends a user: token stops working, sessions end, reactivation restores access, every change is logged', async () => {
    await RefreshToken.create({ userId: customer1.user._id, tokenHash: 'abc'.repeat(20), expiresAt: new Date(Date.now() + 86_400_000) });
    const url = `/admin/users/${customer1.user._id}/status`;

    const res = await boss.patch(url, { status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.status).toBe('suspended');
    const me = await as(customer1).get('/users/me');
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await RefreshToken.findOne({ userId: customer1.user._id })).revoked).toBe(true);

    await boss.patch(url, { status: 'suspended' }); // same again: no change, no new log entry
    expect(await AuditLog.countDocuments({ action: 'user.status' })).toBe(1);

    expect((await boss.patch(url, { status: 'active' })).status).toBe(200);
    expect((await as(customer1).get('/users/me')).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'user.status' })).toBe(2);
  });

  it('protects admin accounts and validates input', async () => {
    const other = await makeUser({ role: 'admin' });
    expect((await boss.patch(`/admin/users/${other.user._id}/status`, { status: 'suspended' })).body.error.code).toBe('CANNOT_MODIFY_ADMIN');
    expect((await boss.patch(`/admin/users/${admin.user._id}/status`, { status: 'suspended' })).status).toBe(403);
    expect((await boss.patch('/admin/users/64b7f8f8f8f8f8f8f8f8f8f8/status', { status: 'suspended' })).status).toBe(404);
    const url = `/admin/users/${customer1.user._id}/status`;
    expect((await boss.patch(url, { status: 'banned' })).status).toBe(422);
    expect((await boss.patch(url, { status: 'active', role: 'admin' })).status).toBe(422);
  });

  it('a suspended seller disappears from the shop and returns when reactivated', async () => {
    await makeProduct(sellerOk.user._id, category._id, { title: 'Seller Mouse' });
    expect(await visibleTitles()).toContain('Seller Mouse');
    await boss.patch(`/admin/users/${sellerOk.user._id}/status`, { status: 'suspended' });
    expect(await visibleTitles()).not.toContain('Seller Mouse');
    await boss.patch(`/admin/users/${sellerOk.user._id}/status`, { status: 'active' });
    expect(await visibleTitles()).toContain('Seller Mouse');
  });
});

describe('seller applications (AC-ADMIN)', () => {
  it('lists the pending queue with product counts, oldest first', async () => {
    await makeProduct(sellerPending.user._id, category._id);
    const { data } = (await boss.get('/admin/sellers?status=pending')).body;
    expect(data.total).toBe(1);
    expect(data.items[0]).toMatchObject({ role: 'seller', productCount: 1 });
    expect(data.items[0].seller.approvalStatus).toBe('pending');
    expect((await boss.get('/admin/sellers?status=approved')).body.data.total).toBe(1);
    expect((await boss.get('/admin/sellers?status=maybe')).status).toBe(422);
  });

  it('a pending seller cannot list products until an admin approves, then can at once', async () => {
    const create = () => request(app).post(api('/products')).set(sellerPending.auth).send(validProductBody(category._id));
    expect((await create()).body.error.code).toBe('SELLER_NOT_APPROVED');

    const res = await boss.patch(`/admin/sellers/${sellerPending.user._id}/approval`, { approvalStatus: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.seller.approvalStatus).toBe('approved');
    expect((await create()).status).toBe(201);

    const log = await AuditLog.findOne({ action: 'seller.approval' });
    expect(String(log.actorId)).toBe(String(admin.user._id));
    expect(log.meta.approvalStatus).toBe('approved');
  });

  it('rejecting hides the sellers listings and blocks new ones; re-approving restores only those it hid', async () => {
    const live = await makeProduct(sellerOk.user._id, category._id, { title: 'Live Item' });
    const adminHidden = await makeProduct(sellerOk.user._id, category._id, { title: 'Admin Hidden', status: 'hidden', hiddenReason: 'admin' });
    const url = `/admin/sellers/${sellerOk.user._id}/approval`;

    await boss.patch(url, { approvalStatus: 'rejected', reason: 'Documents missing' });
    expect((await Product.findById(live._id)).hiddenReason).toBe('seller_rejected');
    expect(await visibleTitles()).not.toContain('Live Item');
    const create = await request(app).post(api('/products')).set(sellerOk.auth).send(validProductBody(category._id));
    expect(create.status).toBe(403);

    await boss.patch(url, { approvalStatus: 'approved' });
    expect((await Product.findById(live._id)).status).toBe('active');
    expect((await Product.findById(adminHidden._id)).status).toBe('hidden'); // admin decision stays
    expect(await visibleTitles()).toContain('Live Item');
  });

  it('answering with the same decision again changes nothing and logs nothing', async () => {
    const url = `/admin/sellers/${sellerOk.user._id}/approval`;
    expect((await boss.patch(url, { approvalStatus: 'approved' })).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'seller.approval' })).toBe(0);
  });

  it('validates the request and the target', async () => {
    expect((await boss.patch(`/admin/sellers/${customer1.user._id}/approval`, { approvalStatus: 'approved' })).status).toBe(404);
    const url = `/admin/sellers/${sellerPending.user._id}/approval`;
    expect((await boss.patch(url, { approvalStatus: 'pending' })).status).toBe(422);
    expect((await boss.patch(url, { approvalStatus: 'rejected', reason: 'no' })).status).toBe(422);
    expect((await boss.patch(url, {})).status).toBe(422);
  });
});
