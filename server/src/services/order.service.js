import mongoose from 'mongoose';
import { CUSTOMER_CANCELLABLE, SELLER_TRANSITIONS } from '../config/constants.js';
import { emit } from '../events/emitter.js';
import '../events/listeners.js';
import { Cart } from '../models/cart.model.js';
import { Order } from '../models/order.model.js';
import { Product } from '../models/product.model.js';
import { SubOrder } from '../models/subOrder.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';

const id = (v) => String(v);
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

// ---------- views ----------

export function subOrderView(s, extra = {}) {
  return {
    id: id(s._id),
    orderId: id(s.orderId),
    sellerId: id(s.sellerId?._id ?? s.sellerId),
    status: s.status,
    items: s.items.map((i) => ({
      productId: id(i.productId),
      title: i.title,
      price: i.price,
      qty: i.qty,
      lineTotal: i.price * i.qty,
    })),
    subtotal: s.subtotal,
    statusHistory: s.statusHistory.map((h) => ({ status: h.status, at: h.at })),
    createdAt: s.createdAt,
    ...extra,
  };
}

// One status for the whole order: Cancelled only if every package is cancelled; otherwise the
// slowest package that is still alive.
export function combinedStatus(subOrders) {
  const alive = subOrders.filter((s) => s.status !== 'Cancelled');
  if (alive.length === 0) return 'Cancelled';
  const order = ['Pending', 'Confirmed', 'Shipped', 'Delivered'];
  return alive.reduce(
    (slowest, s) => (order.indexOf(s.status) < order.indexOf(slowest) ? s.status : slowest),
    'Delivered',
  );
}

const orderView = (order, subOrders, sellerNames = new Map()) => ({
  id: id(order._id),
  status: combinedStatus(subOrders),
  total: order.total,
  paymentMethod: order.paymentMethod,
  address: { line1: order.address.line1, city: order.address.city, phone: order.address.phone },
  createdAt: order.createdAt,
  subOrders: subOrders.map((s) =>
    subOrderView(s, { sellerName: sellerNames.get(id(s.sellerId)) ?? null }),
  ),
});

async function sellerNameMap(subOrders) {
  const sellers = await User.find({ _id: { $in: subOrders.map((s) => s.sellerId) } }).select(
    'seller.businessName',
  );
  return new Map(sellers.map((u) => [id(u._id), u.seller?.businessName]));
}

// ---------- checkout ----------

async function explainFailure(item, session) {
  const product = await Product.findById(item.productId)
    .session(session)
    .select('title stock status');
  if (!product || product.status !== 'active') {
    throw new ApiError(
      409,
      'PRODUCT_UNAVAILABLE',
      `"${product?.title ?? 'An item'}" is no longer available`,
      {
        productId: id(item.productId),
      },
    );
  }
  throw new ApiError(409, 'OUT_OF_STOCK', `Only ${product.stock} left for ${product.title}`, {
    productId: id(item.productId),
    available: product.stock,
  });
}

// Everything below runs in ONE transaction: stock for every item, the order, the sub-orders and
// the cart clearing succeed together or not at all (SRS FR-19, AC-ORDER).
async function placeOrder(userId, { address, paymentMethod }, session) {
  const cart = await Cart.findOne({ userId }).session(session);
  if (!cart || cart.items.length === 0) throw new ApiError(409, 'CART_EMPTY', 'Your cart is empty');

  const lines = [];
  // Fixed order (by product id) keeps parallel checkouts from locking products in opposite orders.
  const items = [...cart.items].sort((a, b) => id(a.productId).localeCompare(id(b.productId)));
  for (const item of items) {
    // Conditional decrement: succeeds only while enough stock is left, so stock can never go negative.
    const product = await Product.findOneAndUpdate(
      { _id: item.productId, status: 'active', stock: { $gte: item.qty } },
      { $inc: { stock: -item.qty } },
      { session, new: true },
    ).select('sellerId title price');
    if (!product) await explainFailure(item, session);
    // Price and title are read from the same document we just updated: no stale-price race.
    lines.push({
      productId: product._id,
      sellerId: product.sellerId,
      title: product.title,
      price: product.price,
      qty: item.qty,
    });
  }

  const bySeller = new Map();
  for (const line of lines)
    bySeller.set(id(line.sellerId), [...(bySeller.get(id(line.sellerId)) ?? []), line]);

  const orderId = new mongoose.Types.ObjectId();
  const now = new Date();
  const subDocs = [...bySeller.values()].map((sellerLines) => ({
    _id: new mongoose.Types.ObjectId(),
    orderId,
    customerId: userId,
    sellerId: sellerLines[0].sellerId,
    items: sellerLines.map(({ productId, title, price, qty }) => ({
      productId,
      title,
      price,
      qty,
    })),
    subtotal: sum(sellerLines, (l) => l.price * l.qty),
    status: 'Pending',
    statusHistory: [{ status: 'Pending', at: now, by: userId }],
  }));

  const [order] = await Order.create(
    [
      {
        _id: orderId,
        customerId: userId,
        address,
        paymentMethod,
        total: sum(subDocs, (s) => s.subtotal),
        subOrderIds: subDocs.map((s) => s._id),
      },
    ],
    { session },
  );
  const subOrders = await SubOrder.create(subDocs, { session, ordered: true });
  await Cart.updateOne({ userId }, { $set: { items: [] } }, { session });
  return { order, subOrders };
}

export async function checkout(userId, input) {
  const session = await mongoose.startSession();
  let result;
  try {
    // withTransaction re-runs the callback on transient errors (for example two buyers racing for the last unit).
    await session.withTransaction(async () => {
      result = await placeOrder(userId, input, session);
    });
  } finally {
    await session.endSession();
  }
  // Emails are awaited before we reply (serverless functions may be frozen after the response).
  await emit('order.created', result);
  return orderView(result.order, result.subOrders, await sellerNameMap(result.subOrders));
}

// ---------- customer reads ----------

export async function listOrders(userId, { page, limit }) {
  const [orders, total] = await Promise.all([
    Order.find({ customerId: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments({ customerId: userId }),
  ]);
  const subs = await SubOrder.find({ orderId: { $in: orders.map((o) => o._id) } });
  const names = await sellerNameMap(subs);
  const items = orders.map((o) =>
    orderView(
      o,
      subs.filter((s) => id(s.orderId) === id(o._id)),
      names,
    ),
  );
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

export async function getOrder(userId, orderId) {
  // Not found and "not yours" look the same, so ids of other people's orders cannot be probed.
  const order = await Order.findOne({ _id: orderId, customerId: userId });
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
  const subs = await SubOrder.find({ orderId: order._id });
  return orderView(order, subs, await sellerNameMap(subs));
}

// ---------- customer cancel ----------

export async function cancelSubOrder(userId, subOrderId) {
  const session = await mongoose.startSession();
  let cancelled;
  try {
    await session.withTransaction(async () => {
      // Atomic: only one request can move it out of a cancellable state, so stock is restored once.
      cancelled = await SubOrder.findOneAndUpdate(
        { _id: subOrderId, customerId: userId, status: { $in: CUSTOMER_CANCELLABLE } },
        {
          $set: { status: 'Cancelled' },
          $push: { statusHistory: { status: 'Cancelled', at: new Date(), by: userId } },
        },
        { session, new: true },
      );
      if (!cancelled) return;
      await Product.bulkWrite(
        cancelled.items.map((i) => ({
          updateOne: { filter: { _id: i.productId }, update: { $inc: { stock: i.qty } } },
        })),
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  if (!cancelled) {
    const exists = await SubOrder.exists({ _id: subOrderId, customerId: userId });
    if (!exists) throw new ApiError(404, 'SUB_ORDER_NOT_FOUND', 'Order package not found');
    throw new ApiError(409, 'INVALID_TRANSITION', 'This package can no longer be cancelled');
  }
  await emit('sub-order.status_changed', { subOrder: cancelled });
  return subOrderView(cancelled);
}

// ---------- seller ----------

export async function listSellerSubOrders(sellerId, { status, page, limit }) {
  const filter = { sellerId, ...(status && { status }) };
  const [subs, total] = await Promise.all([
    SubOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customerId', 'name')
      .populate('orderId', 'address paymentMethod'),
    SubOrder.countDocuments(filter),
  ]);
  const items = subs.map((s) =>
    subOrderView(
      { ...s.toObject(), orderId: s.orderId?._id, customerId: undefined },
      {
        customerName: s.customerId?.name ?? null,
        paymentMethod: s.orderId?.paymentMethod,
        shipTo: s.orderId
          ? {
              line1: s.orderId.address.line1,
              city: s.orderId.address.city,
              phone: s.orderId.address.phone,
            }
          : null,
      },
    ),
  );
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

export async function updateSellerStatus(sellerId, subOrderId, target) {
  const required = SELLER_TRANSITIONS[target];
  // The current status is part of the filter: forward only, and a customer cancelling at the same
  // moment cannot be overwritten.
  const updated = await SubOrder.findOneAndUpdate(
    { _id: subOrderId, sellerId, status: required },
    {
      $set: { status: target },
      $push: { statusHistory: { status: target, at: new Date(), by: sellerId } },
    },
    { new: true },
  );
  if (!updated) {
    const exists = await SubOrder.exists({ _id: subOrderId, sellerId });
    if (!exists) throw new ApiError(404, 'SUB_ORDER_NOT_FOUND', 'Order package not found');
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      `Only a ${required} package can move to ${target}`,
    );
  }
  await emit('sub-order.status_changed', { subOrder: updated });
  return subOrderView(updated);
}
