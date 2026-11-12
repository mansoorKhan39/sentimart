import request from 'supertest';
import mongoose from 'mongoose';


const TEST_URI = process.env.TEST_MONGODB_URI;

let mongod;
let app;
let User;
let authService;

const creds = { name: 'Ali Khan', email: 'ali@example.com', password: 'Str0ngPass1' };
const api = (path) => `/api/v1${path}`;
const cookieOf = (res) => res.headers['set-cookie'][0].split(';')[0];

beforeAll(async () => {
  if (TEST_URI) {
    if (!/\/sentimart_test(\?|$)/.test(TEST_URI)) {
      throw new Error('TEST_MONGODB_URI must use the database name sentimart_test (it gets wiped)');
    }
    await mongoose.connect(TEST_URI);
  } else {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongod.getUri());
  }
  ({ default: app } = await import('../../src/app.js'));
  ({ User } = await import('../../src/models/user.model.js'));
  authService = await import('../../src/services/auth.service.js');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

const register = (body = creds) => request(app).post(api('/auth/register')).send(body);
const login = (body = { email: creds.email, password: creds.password }) =>
  request(app).post(api('/auth/login')).send(body);

describe('health', () => {
  it('GET /health works without auth', async () => {
    const res = await request(app).get(api('/health'));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });
});

describe('register', () => {
  it('creates a customer and never returns the password hash (AC-AUTH)', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('customer');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Str0ngPass1/);
    const stored = await User.findOne({ email: creds.email }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(creds.password);
  });

  it('rejects a duplicate email with 409', async () => {
    await register();
    const res = await register();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('does not allow self-registering as admin or sending unknown fields', async () => {
    expect((await register({ ...creds, role: 'admin' })).status).toBe(422);
    expect((await register({ ...creds, isAdmin: true })).status).toBe(422);
  });

  it('requires businessName for sellers and starts them as pending', async () => {
    expect((await register({ ...creds, role: 'seller' })).status).toBe(422);
    const res = await register({ ...creds, role: 'seller', businessName: 'Ali Traders' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.seller.approvalStatus).toBe('pending');
  });

  it('rejects weak passwords', async () => {
    expect((await register({ ...creds, password: 'short' })).status).toBe(422);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await register();
  });

  it('returns an access token and an httpOnly refresh cookie', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=.+HttpOnly/i);
  });

  it('returns 401 for a wrong password and for an unknown email', async () => {
    expect((await login({ email: creds.email, password: 'Wrong1234' })).status).toBe(401);
    expect((await login({ email: 'nobody@example.com', password: 'Wrong1234' })).status).toBe(401);
  });

  it('rejects NoSQL injection payloads (AC-SEC)', async () => {
    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
  });

  it('locks after 5 failures: the 6th attempt returns 429 even with the right password', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await login({ email: creds.email, password: 'Wrong1234' })).status).toBe(401);
    }
    const res = await login();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('blocks suspended users with 403', async () => {
    await User.updateOne({ email: creds.email }, { status: 'suspended' });
    expect((await login()).status).toBe(403);
  });
});

describe('protected routes', () => {
  it('returns 401 without a token and works with one', async () => {
    await register();
    expect((await request(app).get(api('/users/me'))).status).toBe(401);
    const { body } = await login();
    const res = await request(app)
      .get(api('/users/me'))
      .set('Authorization', `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(creds.email);
  });

  it('PATCH /users/me updates the name and rejects role changes', async () => {
    await register();
    const { body } = await login();
    const auth = { Authorization: `Bearer ${body.data.accessToken}` };
    const ok = await request(app).patch(api('/users/me')).set(auth).send({ name: 'Ali K' });
    expect(ok.body.data.user.name).toBe('Ali K');
    const bad = await request(app).patch(api('/users/me')).set(auth).send({ role: 'admin' });
    expect(bad.status).toBe(422);
  });

  it('blocks a suspended user who still holds a valid token', async () => {
    await register();
    const { body } = await login();
    await User.updateOne({ email: creds.email }, { status: 'suspended' });
    const res = await request(app)
      .get(api('/users/me'))
      .set('Authorization', `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe('refresh and logout', () => {
  it('rotates the refresh token and revokes the family on replay', async () => {
    await register();
    const first = cookieOf(await login());
    const rotated = await request(app).post(api('/auth/refresh')).set('Cookie', first);
    expect(rotated.status).toBe(200);
    const second = cookieOf(rotated);
    expect(second).not.toBe(first);

    expect((await request(app).post(api('/auth/refresh')).set('Cookie', first)).status).toBe(401);
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', second)).status).toBe(401);
  });

  it('logout invalidates the refresh token server-side (TC-03)', async () => {
    await register();
    const cookie = cookieOf(await login());
    expect((await request(app).post(api('/auth/logout')).set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', cookie)).status).toBe(401);
  });

  it('refresh without a cookie returns 401', async () => {
    expect((await request(app).post(api('/auth/refresh'))).status).toBe(401);
  });
});

describe('password reset', () => {
  it('answers 200 for unknown emails (no account enumeration)', async () => {
    const res = await request(app)
      .post(api('/auth/forgot-password'))
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });

  it('works once, then the link is rejected (TC-04)', async () => {
    await register();
    const token = await authService.forgotPassword(creds.email);
    const set = await request(app)
      .post(api(`/auth/reset-password/${token}`))
      .send({ password: 'NewStr0ngPass2' });
    expect(set.status).toBe(200);
    expect((await login({ email: creds.email, password: 'NewStr0ngPass2' })).status).toBe(200);
    const again = await request(app)
      .post(api(`/auth/reset-password/${token}`))
      .send({ password: 'Another3Pass' });
    expect(again.status).toBe(400);
  });

  it('rejects an expired link', async () => {
    await register();
    const token = await authService.forgotPassword(creds.email);
    await User.updateOne({ email: creds.email }, { resetExpires: new Date(Date.now() - 1000) });
    const res = await request(app)
      .post(api(`/auth/reset-password/${token}`))
      .send({ password: 'NewStr0ngPass2' });
    expect(res.status).toBe(400);
  });
});

describe('platform hardening', () => {
  it('rejects bodies over 10 KB (AC-SEC)', async () => {
    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: 'a@b.co', password: 'x'.repeat(11000) });
    expect(res.status).toBe(413);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get(api('/nope'));
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
