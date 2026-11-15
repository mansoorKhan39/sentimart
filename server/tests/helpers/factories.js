import mongoose from 'mongoose';
import { Category } from '../../src/models/category.model.js';
import { Product } from '../../src/models/product.model.js';
import { Review } from '../../src/models/review.model.js';
import { SubOrder } from '../../src/models/subOrder.model.js';
import { User } from '../../src/models/user.model.js';
import { signAccessToken } from '../../src/utils/tokens.js';
import { slugify } from '../../src/utils/strings.js';

let seq = 0;

// Creates a user directly in the DB and a valid access token (skips the slow bcrypt login).
export async function makeUser({ role = 'customer', approval = 'approved' } = {}) {
  seq += 1;
  const user = await User.create({
    name: `Test ${role} ${seq}`,
    email: `${role}${seq}@example.com`,
    passwordHash: 'not-used-in-these-tests',
    role,
    ...(role === 'seller' && { seller: { businessName: `Shop ${seq}`, approvalStatus: approval } }),
  });
  return { user, auth: { Authorization: `Bearer ${signAccessToken(user)}` } };
}

export const makeCategory = (name = 'Electronics') => Category.create({ name, slug: slugify(name) });

export function productData(sellerId, categoryId, overrides = {}) {
  seq += 1;
  return {
    sellerId,
    categoryId,
    title: `Product ${seq}`,
    description: 'A perfectly fine product description.',
    price: 100000,
    stock: 10,
    ...overrides,
  };
}

export const makeProduct = (sellerId, categoryId, overrides) =>
  Product.create(productData(sellerId, categoryId, overrides));

export const validProductBody = (categoryId, overrides = {}) => ({
  title: 'Wireless Mouse',
  description: 'Ergonomic 2.4GHz wireless mouse',
  price: 249900,
  stock: 25,
  categoryId: String(categoryId),
  ...overrides,
});

// A package of one product for a customer, in the given status (default Delivered).
export function makePackage(customerUser, product, status = 'Delivered') {
  return SubOrder.create({
    orderId: new mongoose.Types.ObjectId(),
    customerId: customerUser._id,
    sellerId: product.sellerId,
    items: [{ productId: product._id, title: product.title, price: product.price, qty: 1 }],
    subtotal: product.price,
    status,
    statusHistory: [{ status }],
  });
}

// A package sold by `seller` to `customer`. lines: [{ product, qty }]. createdAt lets tests place it in time.
export function makeSale({ seller, customer, lines, status = 'Delivered', createdAt }) {
  const items = lines.map(({ product, qty = 1 }) => ({
    productId: product._id,
    title: product.title,
    price: product.price,
    qty,
  }));
  return SubOrder.create({
    orderId: new mongoose.Types.ObjectId(),
    customerId: customer._id,
    sellerId: seller._id,
    items,
    subtotal: items.reduce((sum, i) => sum + i.price * i.qty, 0),
    status,
    statusHistory: [{ status }],
    ...(createdAt && { createdAt }),
  });
}

// A review written directly in the database (no NLP call), for dashboard and moderation tests.
export function makeReview({
  product,
  author,
  label = 'positive',
  score,
  rating,
  text,
  createdAt,
  status = 'published',
  analysisStatus = 'done',
  keywords = [],
  reply,
  spamScore = 0,
  spamReasons = [],
}) {
  seq += 1;
  const defaults = { negative: [1, -0.6], neutral: [3, 0], positive: [5, 0.6] }[label];
  return Review.create({
    productId: product._id,
    authorId: author._id,
    subOrderId: new mongoose.Types.ObjectId(),
    rating: rating ?? defaults[0],
    text: text ?? `Review number ${seq} written for testing purposes`,
    analysisStatus,
    status,
    spamScore,
    spamReasons,
    ...(analysisStatus === 'done' && { sentiment: { label, score: score ?? defaults[1], keywords } }),
    ...(reply && { reply: { text: reply, at: new Date() } }),
    ...(createdAt && { createdAt }),
  });
}
