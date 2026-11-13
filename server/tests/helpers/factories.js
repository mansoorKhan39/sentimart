import { Category } from '../../src/models/category.model.js';
import { Product } from '../../src/models/product.model.js';
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
