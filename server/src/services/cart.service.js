import { Cart } from '../models/cart.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';

// Builds the cart response: lines, per-seller groups and totals (all money in minor units).
export async function getCartView(userId) {
  const cart = await Cart.findOne({ userId }).populate({
    path: 'items.productId',
    select: 'title price stock images status sellerId',
    populate: { path: 'sellerId', select: 'seller.businessName' },
  });

  const items = [];
  const groups = new Map();
  for (const item of cart?.items ?? []) {
    const product = item.productId;
    if (!product) continue; // product was deleted: silently skipped
    const available = product.status === 'active' && product.stock >= item.qty;
    const line = {
      productId: String(product._id),
      title: product.title,
      image: product.images?.[0]?.url ?? null,
      unitPrice: product.price,
      qty: item.qty,
      stock: product.stock,
      available,
      lineTotal: product.price * item.qty,
    };
    items.push(line);

    const sellerId = String(product.sellerId?._id ?? product.sellerId);
    if (!groups.has(sellerId)) {
      groups.set(sellerId, {
        sellerId,
        businessName: product.sellerId?.seller?.businessName ?? null,
        items: [],
        subtotal: 0,
      });
    }
    const group = groups.get(sellerId);
    group.items.push(line);
    if (available) group.subtotal += line.lineTotal;
  }

  const buyable = items.filter((line) => line.available);
  return {
    items,
    groups: [...groups.values()],
    itemCount: buyable.reduce((sum, line) => sum + line.qty, 0),
    total: buyable.reduce((sum, line) => sum + line.lineTotal, 0),
    hasUnavailable: items.some((line) => !line.available),
  };
}

export async function setItemQuantity(userId, productId, qty) {
  const product = await Product.findOne({ _id: productId, status: 'active' }).select('stock');
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (qty > product.stock) {
    throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} left in stock`, {
      available: product.stock,
    });
  }

  const setQty = () =>
    Cart.updateOne({ userId, 'items.productId': productId }, { $set: { 'items.$.qty': qty } });

  // Parallel requests can race (first add creates the cart, a duplicate-key error tells us
  // someone else got there first), so retry a few times: set the quantity, otherwise push the line.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await setQty()).matchedCount > 0) break;
    try {
      await Cart.updateOne(
        { userId, 'items.productId': { $ne: productId } },
        { $push: { items: { productId, qty } } },
        { upsert: true },
      );
      break;
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  return getCartView(userId);
}

export async function removeItem(userId, productId) {
  await Cart.updateOne({ userId }, { $pull: { items: { productId } } });
  return getCartView(userId);
}

export async function clearCart(userId) {
  await Cart.updateOne({ userId }, { $set: { items: [] } });
  return getCartView(userId);
}
