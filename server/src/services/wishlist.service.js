import { Product } from '../models/product.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { PUBLIC_POPULATE } from './product.service.js';

async function wishlistIds(userId) {
  const user = await User.findById(userId).select('wishlist');
  return (user?.wishlist ?? []).map(String);
}

export async function listWishlist(userId) {
  const ids = await wishlistIds(userId);
  const products = await Product.find({ _id: { $in: ids }, status: 'active' }).populate(PUBLIC_POPULATE);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return ids.filter((id) => byId.has(id)).map((id) => byId.get(id).toPublic());
}

export async function addToWishlist(userId, productId) {
  if (!(await Product.exists({ _id: productId, status: 'active' }))) {
    throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  await User.updateOne({ _id: userId }, { $addToSet: { wishlist: productId } });
  return wishlistIds(userId);
}

export async function removeFromWishlist(userId, productId) {
  await User.updateOne({ _id: userId }, { $pull: { wishlist: productId } });
  return wishlistIds(userId);
}
