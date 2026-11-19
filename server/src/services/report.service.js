import { Order } from '../models/order.model.js';
import { Product } from '../models/product.model.js';
import { Review } from '../models/review.model.js';
import { SubOrder } from '../models/subOrder.model.js';
import { User } from '../models/user.model.js';
import { SUB_ORDER_STATUSES } from '../config/constants.js';
import { bucketKey, buckets, resolveRange } from '../utils/dates.js';

const tally = (rows, keys) => {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) out[r._id] = r.count;
  return out;
};
const truncate = (unit) => ({
  $dateTrunc: {
    date: '$createdAt',
    unit,
    timezone: 'UTC',
    ...(unit === 'week' && { startOfWeek: 'monday' }),
  },
});

// Platform numbers for the admin dashboard (SRS FR-39): users, sales, orders, flagged-review rate.
export async function platformReport(query) {
  const range = resolveRange(query);
  const inRange = { createdAt: { $gte: range.start, $lt: range.end } };
  const sold = { ...inRange, status: { $ne: 'Cancelled' } };

  const [
    userRows,
    newUsers,
    sellerRows,
    productRows,
    orderCount,
    orderSeries,
    saleSeries,
    [saleTotals],
    packageRows,
    reviewRows,
    sentimentRows,
    [ratingRow],
    topSellerRows,
    topProducts,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: { role: '$role', status: '$status' }, count: { $sum: 1 } } }]),
    User.countDocuments(inRange),
    User.aggregate([
      { $match: { role: 'seller' } },
      { $group: { _id: '$seller.approvalStatus', count: { $sum: 1 } } },
    ]),
    Product.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.countDocuments(inRange),
    Order.aggregate([{ $match: inRange }, { $group: { _id: truncate(range.unit), orders: { $sum: 1 } } }]),
    SubOrder.aggregate([
      { $match: sold },
      { $group: { _id: truncate(range.unit), revenue: { $sum: '$subtotal' } } },
    ]),
    SubOrder.aggregate([{ $match: sold }, { $group: { _id: null, revenue: { $sum: '$subtotal' } } }]),
    SubOrder.aggregate([{ $match: inRange }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Review.aggregate([{ $match: inRange }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Review.aggregate([
      { $match: { ...inRange, status: 'published', analysisStatus: 'done' } },
      { $group: { _id: '$sentiment.label', count: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: { ...inRange, status: 'published' } },
      { $group: { _id: null, avgRating: { $avg: '$rating' } } },
    ]),
    SubOrder.aggregate([
      { $match: sold },
      { $group: { _id: '$sellerId', revenue: { $sum: '$subtotal' }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1, _id: 1 } },
      { $limit: 5 },
    ]),
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

  const sellers = await User.find({ _id: { $in: topSellerRows.map((r) => r._id) } }).select('seller.businessName');
  const nameOf = new Map(sellers.map((s) => [String(s._id), s.seller?.businessName ?? null]));

  const roles = { customer: 0, seller: 0, admin: 0 };
  let suspended = 0;
  for (const r of userRows) {
    roles[r._id.role] += r.count;
    if (r._id.status === 'suspended') suspended += r.count;
  }
  const orderBy = new Map(orderSeries.map((r) => [bucketKey(r._id), r.orders]));
  const saleBy = new Map(saleSeries.map((r) => [bucketKey(r._id), r.revenue]));
  const reviews = tally(reviewRows, ['published', 'flagged', 'removed']);
  const reviewTotal = reviews.published + reviews.flagged + reviews.removed;
  const revenue = saleTotals?.revenue ?? 0;

  return {
    range: { from: range.start.toISOString(), to: range.end.toISOString(), interval: range.unit },
    users: {
      total: roles.customer + roles.seller + roles.admin,
      byRole: roles,
      suspended,
      newInRange: newUsers,
    },
    sellers: tally(sellerRows, ['pending', 'approved', 'rejected']),
    products: { ...tally(productRows, ['active', 'hidden']) },
    sales: {
      revenue,
      orders: orderCount,
      avgOrderValue: orderCount ? Math.round(revenue / orderCount) : 0,
      byStatus: tally(packageRows, SUB_ORDER_STATUSES),
      series: buckets(range).map((d) => ({
        date: bucketKey(d),
        revenue: saleBy.get(bucketKey(d)) ?? 0,
        orders: orderBy.get(bucketKey(d)) ?? 0,
      })),
    },
    reviews: {
      ...reviews,
      total: reviewTotal,
      // share of reviews that were caught by the spam checks or removed by an admin
      flaggedRate: reviewTotal ? Number((((reviews.flagged + reviews.removed) / reviewTotal) * 100).toFixed(1)) : 0,
      avgRating: ratingRow ? Number(ratingRow.avgRating.toFixed(2)) : null,
      sentiment: tally(sentimentRows, ['positive', 'neutral', 'negative']),
    },
    topSellers: topSellerRows.map((r) => ({
      sellerId: String(r._id),
      businessName: nameOf.get(String(r._id)) ?? null,
      revenue: r.revenue,
      orders: r.orders,
    })),
    topProducts: topProducts.map((p) => ({
      productId: String(p._id),
      title: p.title,
      units: p.units,
      revenue: p.revenue,
    })),
    // all-time work queues for the admin dashboard badges
    queues: {
      pendingSellers: sellerRows.find((r) => r._id === 'pending')?.count ?? 0,
      flaggedReviews: await Review.countDocuments({ status: 'flagged' }),
    },
  };
}
