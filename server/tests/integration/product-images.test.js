import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import { Product } from '../../src/models/product.model.js';
import { clearDb, closeTestDb, connectTestDb, initModels } from '../helpers/db.js';
import { makeCategory, makeProduct, makeUser } from '../helpers/factories.js';

const api = (path) => `/api/v1${path}`;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (bytes = 1024) => Buffer.concat([PNG_HEADER, Buffer.alloc(bytes)]);
const attach = (req, buffer, name = 'photo.png', type = 'image/png') =>
  req.attach('images', buffer, { filename: name, contentType: type });

let mongod;
let owner;
let product;
let fetchSpy;
let uploads = 0;

const cloudinaryOk = () => ({
  ok: true,
  json: async () => {
    uploads += 1;
    return {
      secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/p${uploads}.png`,
      public_id: `sentimart/products/p${uploads}`,
    };
  },
});

beforeAll(async () => {
  mongod = await connectTestDb();
  await initModels();
});
afterAll(() => closeTestDb(mongod));

beforeEach(async () => {
  await clearDb();
  uploads = 0;
  owner = await makeUser({ role: 'seller' });
  const category = await makeCategory();
  product = await makeProduct(owner.user._id, category._id);
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => cloudinaryOk());
});
afterEach(() => jest.restoreAllMocks());

const uploadUrl = () => api(`/products/${product._id}/images`);

describe('product images (Cloudinary)', () => {
  it('uploads a valid image and never exposes the Cloudinary public id', async () => {
    const res = await attach(request(app).post(uploadUrl()).set(owner.auth), png());
    expect(res.status).toBe(201);
    expect(res.body.data.product.images).toHaveLength(1);
    expect(res.body.data.product.images[0].url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(JSON.stringify(res.body)).not.toMatch(/publicId|public_id/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/test-cloud/image/upload');
  });

  it('rejects files whose content is not an image, even if named .png (TC-05)', async () => {
    const fake = await attach(request(app).post(uploadUrl()).set(owner.auth), Buffer.from('just some text, not a picture'));
    expect(fake.status).toBe(422);
    expect(fake.body.error.code).toBe('INVALID_IMAGE');
    const pdf = await attach(request(app).post(uploadUrl()).set(owner.auth), Buffer.from('%PDF-1.7 fake pdf body'), 'doc.pdf', 'application/pdf');
    expect(pdf.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects files larger than 2 MB (TC-05)', async () => {
    const res = await attach(request(app).post(uploadUrl()).set(owner.auth), png(3 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects more than 2 files per request', async () => {
    const req = request(app).post(uploadUrl()).set(owner.auth);
    attach(req, png());
    attach(req, png());
    attach(req, png());
    const res = await req;
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPLOAD_ERROR');
  });

  it('returns 422 when no file is attached', async () => {
    const res = await request(app).post(uploadUrl()).set(owner.auth);
    expect(res.status).toBe(422);
  });

  it('allows at most 5 images per product', async () => {
    await Product.updateOne(
      { _id: product._id },
      { $set: { images: Array.from({ length: 5 }, (_, i) => ({ url: `https://x.test/${i}.png`, publicId: `p${i}` })) } },
    );
    const res = await attach(request(app).post(uploadUrl()).set(owner.auth), png());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IMAGE_LIMIT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('only the owner can upload (403) and nothing is sent to Cloudinary', async () => {
    const other = await makeUser({ role: 'seller' });
    const customer = await makeUser();
    expect((await attach(request(app).post(uploadUrl()).set(other.auth), png())).status).toBe(403);
    expect((await attach(request(app).post(uploadUrl()).set(customer.auth), png())).status).toBe(403);
    expect((await attach(request(app).post(uploadUrl()), png())).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 502 and saves nothing when Cloudinary fails', async () => {
    fetchSpy.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const res = await attach(request(app).post(uploadUrl()).set(owner.auth), png());
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPLOAD_FAILED');
    expect((await Product.findById(product._id)).images).toHaveLength(0);
  });

  it('removes an image from the product and asks Cloudinary to delete it', async () => {
    const added = await attach(request(app).post(uploadUrl()).set(owner.auth), png());
    const imageId = added.body.data.product.images[0].id;
    const res = await request(app).delete(api(`/products/${product._id}/images/${imageId}`)).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.product.images).toHaveLength(0);
    expect(String(fetchSpy.mock.calls.at(-1)[0])).toContain('/image/destroy');
    const missing = await request(app).delete(api(`/products/${product._id}/images/${imageId}`)).set(owner.auth);
    expect(missing.status).toBe(404);
  });
});
