import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Product } from '../models/product.model.js';
import { Review } from '../models/review.model.js';
import { SubOrder } from '../models/subOrder.model.js';
import { SUB_ORDER_STATUSES } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { toCsv } from '../utils/csv.js';
import { DAY, bucketKey, buckets, resolveRange } from '../utils/dates.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const round = (n, digits) => (n === null || n === undefined ? null : Number(n.toFixed(digits)));
const pct = (current, previous) => (previous ? round(((current - previous) / previous) * 100, 1) : null);
// VADER compound score (-1..1) as a 0..100 gauge: 50 is neutral.
export const sentimentIndex = (avgScore) =>
  avgScore === null || avgScore === undefined ? null : Math.round((avgScore + 1) * 50);

const truncate = (unit) => ({
  $dateTrunc: {
    date: '$createdAt',
    unit,
    timezone: 'UTC',
    ...(unit === 'week' && { startOfWeek: 'monday' }),
  },
});

const rangeInfo = (r) => ({ from: r.start.toISOString(), to: r.end.toISOString(), interval: r.unit });

// Reviews belong to a seller through the product, so look up the seller's product ids first.
async function ownProductIds(sellerId, productId) {
  if (productId) {
    const product = await Product.findOne({ _id: productId, sellerId }).select('_id');
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    return [product._id];
  }
  return Product.find({ sellerId }).distinct('_id');
}

// ---------- sales ----------

export async function salesAnalytics(sellerId, query) {
  const range = resolveRange(query);
  const match = { sellerId: oid(sellerId), createdAt: { $gte: range.start, $lt: range.end } };
  const sold = { ...match, status: { $ne: 'Cancelled' } };

  const [rows, [totals], statusRows, topProducts] = await Promise.all([
    SubOrder.aggregate([
      { $match: sold },
      { $group: { _id: truncate(range.unit), revenue: { $sum: '$subtotal' }, orders: { $sum: 1 } } },
    ]),
    SubOrder.aggregate([
      { $match: sold },
      { $group: { _id: null, revenue: { $sum: '$subtotal' }, orders: { $sum: 1 } } },
    ]),
    SubOrder.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    SubOrder.aggregate([
      { $match: sold },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          title: { $first: '$items.title' },
          units: { $sum: '$items.qty' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
        },
      },
      { $sort: { revenue: -1, _id: 1 } },
      { $limit: 5 },
    ]),
  ]);

  const byKey = new Map(rows.map((r) => [bucketKey(r._id), r]));
  const series = buckets(range).map((d) => {
    const row = byKey.get(bucketKey(d));
    return { date: bucketKey(d), revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 };
  });
  const byStatus = Object.fromEntries(SUB_ORDER_STATUSES.map((s) => [s, 0]));
  for (const row of statusRows) byStatus[row._id] = row.count;

  const revenue = totals?.revenue ?? 0;
  const orders = totals?.orders ?? 0;
  return {
    range: rangeInfo(range),
    totals: {
      revenue,
      orders,
      avgOrderValue: orders ? Math.round(revenue / orders) : 0,
      cancelled: byStatus.Cancelled,
    },
    series,
    byStatus,
    topProducts: topProducts.map((p) => ({
      productId: String(p._id),
      title: p.title,
      units: p.units,
      revenue: p.revenue,
    })),
  };
}

// ---------- sentiment trend ----------

const countLabel = (label) => ({ $sum: { $cond: [{ $eq: ['$sentiment.label', label] }, 1, 0] } });
const sentimentFields = {
  reviews: { $sum: 1 },
  positive: countLabel('positive'),
  neutral: countLabel('neutral'),
  negative: countLabel('negative'),
  pending: { $sum: { $cond: [{ $eq: ['$analysisStatus', 'pending'] }, 1, 0] } },
  avgScore: { $avg: '$sentiment.score' }, // reviews without analysis have no score and are skipped
  avgRating: { $avg: '$rating' },
};

export async function sentimentAnalytics(sellerId, query) {
  const range = resolveRange(query);
  const ids = await ownProductIds(sellerId, query.productId);
  const match = {
    productId: { $in: ids },
    status: 'published',
    createdAt: { $gte: range.start, $lt: range.end },
  };

  const [rows, [overall]] = await Promise.all([
    Review.aggregate([{ $match: match }, { $group: { _id: truncate(range.unit), ...sentimentFields } }]),
    Review.aggregate([{ $match: match }, { $group: { _id: null, ...sentimentFields } }]),
  ]);

  const byKey = new Map(rows.map((r) => [bucketKey(r._id), r]));
  const series = buckets(range).map((d) => {
    const r = byKey.get(bucketKey(d));
    return {
      date: bucketKey(d),
      reviews: r?.reviews ?? 0,
      positive: r?.positive ?? 0,
      neutral: r?.neutral ?? 0,
      negative: r?.negative ?? 0,
      avgScore: round(r?.avgScore ?? null, 3),
    };
  });
  const o = overall ?? {};
  const avgScore = round(o.avgScore ?? null, 3);
  return {
    range: rangeInfo(range),
    overall: {
      reviews: o.reviews ?? 0,
      positive: o.positive ?? 0,
      neutral: o.neutral ?? 0,
      negative: o.negative ?? 0,
      pending: o.pending ?? 0,
      avgScore,
      avgRating: round(o.avgRating ?? null, 2),
      sentimentIndex: sentimentIndex(avgScore),
    },
    series,
  };
}

// ---------- top complaints ----------

export async function complaintsAnalytics(sellerId, query) {
  const range = resolveRange(query);
  const ids = await ownProductIds(sellerId, query.productId);
  const published = {
    productId: { $in: ids },
    status: 'published',
    createdAt: { $gte: range.start, $lt: range.end },
  };
  const negative = { ...published, analysisStatus: 'done', 'sentiment.label': 'negative' };

  const [rows, totalReviews, negativeReviews] = await Promise.all([
    Review.aggregate([
      { $match: negative },
      { $unwind: '$sentiment.keywords' },
      {
        $group: {
          _id: '$sentiment.keywords',
          count: { $sum: 1 },
          products: { $addToSet: '$productId' },
          sample: { $first: '$text' },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $sort: { count: -1, _id: 1 } },
      { $limit: query.limit ?? 10 },
    ]),
    Review.countDocuments(published),
    Review.countDocuments(negative),
  ]);
  return {
    range: rangeInfo(range),
    totalReviews,
    negativeReviews,
    negativeShare: totalReviews ? round((negativeReviews / totalReviews) * 100, 1) : 0,
    complaints: rows.map((r) => ({
      keyword: r._id,
      count: r.count,
      productCount: r.products.length,
      sample: r.sample.length > 140 ? `${r.sample.slice(0, 137)}...` : r.sample,
      lastAt: r.lastAt,
    })),
  };
}

// ---------- dashboard overview (KPI cards) ----------

export async function overview(sellerId) {
  const now = new Date();
  const currentStart = new Date(now.getTime() - 30 * DAY);
  const previousStart = new Date(now.getTime() - 60 * DAY);
  const seller = oid(sellerId);
  const analyzed = { $add: ['$sentiment.positive', '$sentiment.neutral', '$sentiment.negative'] };

  const [periods, statusRows, [stock], ids] = await Promise.all([
    SubOrder.aggregate([
      { $match: { sellerId: seller, status: { $ne: 'Cancelled' }, createdAt: { $gte: previousStart } } },
      {
        $group: {
          _id: { $cond: [{ $gte: ['$createdAt', currentStart] }, 'current', 'previous'] },
          revenue: { $sum: '$subtotal' },
          orders: { $sum: 1 },
        },
      },
    ]),
    SubOrder.aggregate([
      { $match: { sellerId: seller, status: { $in: ['Pending', 'Confirmed'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Product.aggregate([
      { $match: { sellerId: seller } },
      {
        $group: {
          _id: null,
          products: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          lowStock: {
            $sum: {
              $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', env.LOW_STOCK_THRESHOLD] }] }, 1, 0],
            },
          },
          outOfStock: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
          reviewCount: { $sum: '$reviewCount' },
          ratingSum: { $sum: { $multiply: ['$avgRating', '$reviewCount'] } },
          analyzed: { $sum: analyzed },
          scoreSum: { $sum: { $multiply: ['$sentiment.avgScore', analyzed] } },
        },
      },
    ]),
    Product.find({ sellerId }).distinct('_id'),
  ]);

  const period = (name) => periods.find((p) => p._id === name) ?? { revenue: 0, orders: 0 };
  const cur = period('current');
  const prev = period('previous');
  const count = (status) => statusRows.find((r) => r._id === status)?.count ?? 0;
  const s = stock ?? {};
  const avgScore = s.analyzed ? round(s.scoreSum / s.analyzed, 3) : null;
  const unrepliedNegative = await Review.countDocuments({
    productId: { $in: ids },
    status: 'published',
    'sentiment.label': 'negative',
    'reply.text': { $exists: false },
  });

  return {
    revenue: { current: cur.revenue, previous: prev.revenue, changePct: pct(cur.revenue, prev.revenue) },
    orders: { current: cur.orders, previous: prev.orders, changePct: pct(cur.orders, prev.orders) },
    toConfirm: count('Pending'),
    toShip: count('Confirmed'),
    inventory: {
      products: s.products ?? 0,
      active: s.active ?? 0,
      lowStock: s.lowStock ?? 0,
      outOfStock: s.outOfStock ?? 0,
    },
    rating: { avg: s.reviewCount ? round(s.ratingSum / s.reviewCount, 2) : null, count: s.reviewCount ?? 0 },
    sentiment: { avgScore, index: sentimentIndex(avgScore), analyzed: s.analyzed ?? 0 },
    unrepliedNegative,
  };
}

// ---------- CSV export (SRS FR-35) ----------

const rupees = (minor) => (minor / 100).toFixed(2);

export async function exportCsv(sellerId, query) {
  let columns;
  let rows;
  let range;
  if (query.type === 'sales') {
    const data = await salesAnalytics(sellerId, query);
    range = data.range;
    columns = [
      { key: 'date', label: 'date' },
      { key: 'revenue', label: 'revenue_pkr' },
      { key: 'orders', label: 'orders' },
    ];
    rows = data.series.map((r) => ({ ...r, revenue: rupees(r.revenue) }));
  } else if (query.type === 'sentiment') {
    const data = await sentimentAnalytics(sellerId, query);
    range = data.range;
    columns = ['date', 'reviews', 'positive', 'neutral', 'negative', 'avgScore'].map((key) => ({
      key,
      label: key === 'avgScore' ? 'avg_score' : key,
    }));
    rows = data.series;
  } else {
    const data = await complaintsAnalytics(sellerId, { ...query, limit: 25 });
    range = data.range;
    columns = [
      { key: 'keyword', label: 'keyword' },
      { key: 'count', label: 'mentions' },
      { key: 'productCount', label: 'products' },
    ];
    rows = data.complaints;
  }
  const day = (iso) => iso.slice(0, 10);
  return {
    filename: `sentimart-${query.type}-${day(range.from)}_${day(range.to)}.csv`,
    csv: toCsv(columns, rows),
  };
}
