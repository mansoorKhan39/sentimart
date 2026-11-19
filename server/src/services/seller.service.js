import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Product } from '../models/product.model.js';
import { Review } from '../models/review.model.js';
import { escapeRegex } from '../utils/strings.js';
import { reviewView } from './review.service.js';

const lowStock = { $gt: 0, $lte: env.LOW_STOCK_THRESHOLD };

export async function listInventory(sellerId, { q, stock, page, limit }) {
  const filter = { sellerId, ...(q && { title: new RegExp(escapeRegex(q), 'i') }) };
  if (stock === 'low') filter.stock = lowStock;
  if (stock === 'out') filter.stock = 0;

  const [docs, total, [counts]] = await Promise.all([
    Product.find(filter)
      .sort({ stock: 1, title: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('categoryId', 'name slug'),
    Product.countDocuments(filter),
    Product.aggregate([
      { $match: { sellerId: new mongoose.Types.ObjectId(String(sellerId)) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          low: {
            $sum: {
              $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', env.LOW_STOCK_THRESHOLD] }] }, 1, 0],
            },
          },
          out: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  return {
    items: docs.map((p) => ({
      id: String(p._id),
      title: p.title,
      price: p.price,
      stock: p.stock,
      lowStock: p.stock > 0 && p.stock <= env.LOW_STOCK_THRESHOLD,
      status: p.status,
      hiddenReason: p.hiddenReason ?? null,
      image: p.images[0]?.url ?? null,
      category: p.categoryId?.name ? { name: p.categoryId.name, slug: p.categoryId.slug } : null,
      avgRating: p.avgRating,
      reviewCount: p.reviewCount,
      updatedAt: p.updatedAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: { total: counts?.total ?? 0, low: counts?.low ?? 0, out: counts?.out ?? 0, threshold: env.LOW_STOCK_THRESHOLD },
  };
}

// Reviews on the seller's own products (published only: flagged ones wait for the admin).
export async function listSellerReviews(sellerId, { sentiment, replied, productId, page, limit }) {
  const ownIds = await Product.find({ sellerId }).distinct('_id');
  const filter = {
    productId: productId ? { $in: ownIds.filter((id) => String(id) === productId) } : { $in: ownIds },
    status: 'published',
    ...(sentiment && { analysisStatus: 'done', 'sentiment.label': sentiment }),
    ...(replied === 'true' && { 'reply.text': { $exists: true } }),
    ...(replied === 'false' && { 'reply.text': { $exists: false } }),
  };
  const [docs, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('authorId', 'name')
      .populate('productId', 'title'),
    Review.countDocuments(filter),
  ]);
  return {
    items: docs.map((r) => ({
      ...reviewView({ ...r.toObject(), authorId: r.authorId, productId: r.productId?._id }),
      product: { id: String(r.productId?._id), title: r.productId?.title },
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
