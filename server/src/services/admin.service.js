import { Product } from '../models/product.model.js';
import { RefreshToken } from '../models/refreshToken.model.js';
import { Review } from '../models/review.model.js';
import { AuditLog } from '../models/auditLog.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/strings.js';
import { deleteProduct as removeProduct } from './product.service.js';
import { recomputeProductStats } from './review.service.js';

const paged = (items, total, page, limit, extra = {}) => ({
  items,
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  ...extra,
});
const search = (q, fields) =>
  q ? { $or: fields.map((f) => ({ [f]: new RegExp(escapeRegex(q), 'i') })) } : {};

// ---------- users ----------

const userView = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  ...(u.role === 'seller' && {
    seller: { businessName: u.seller?.businessName, approvalStatus: u.seller?.approvalStatus },
  }),
  createdAt: u.createdAt,
});

export async function listUsers({ q, role, status, page, limit }) {
  const filter = { ...search(q, ['name', 'email']), ...(role && { role }), ...(status && { status }) };
  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return paged(docs.map(userView), total, page, limit);
}

// Seller products follow the seller: suspended or rejected -> hidden, restored when reversed.
const hideSellerProducts = (sellerId, reason) =>
  Product.updateMany(
    { sellerId, status: 'active' },
    { $set: { status: 'hidden', hiddenReason: reason } },
  );
const restoreSellerProducts = (sellerId, reason) =>
  Product.updateMany(
    { sellerId, status: 'hidden', hiddenReason: reason },
    { $set: { status: 'active' }, $unset: { hiddenReason: '' } },
  );

export async function setUserStatus(id, status) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  // Admins cannot lock each other (or themselves) out.
  if (user.role === 'admin') throw new ApiError(403, 'CANNOT_MODIFY_ADMIN', 'Admin accounts cannot be suspended');
  if (user.status === status) return { user, changed: false };

  const updated = await User.findByIdAndUpdate(id, { $set: { status } }, { new: true });
  if (status === 'suspended') {
    // Log the user out everywhere. (The access token stops working at once: auth re-checks status.)
    await RefreshToken.updateMany({ userId: id, revoked: false }, { $set: { revoked: true } });
    if (user.role === 'seller') await hideSellerProducts(id, 'seller_suspended');
  } else if (user.role === 'seller') {
    await restoreSellerProducts(id, 'seller_suspended');
  }
  return { user: updated, changed: true };
}

// ---------- sellers ----------

export async function listSellers({ q, status, page, limit }) {
  const filter = {
    role: 'seller',
    ...search(q, ['name', 'email', 'seller.businessName']),
    ...(status && { 'seller.approvalStatus': status }),
  };
  // Oldest application first when working through the pending queue.
  const sort = status === 'pending' ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };
  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  const counts = await Product.aggregate([
    { $match: { sellerId: { $in: docs.map((d) => d._id) } } },
    { $group: { _id: '$sellerId', count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));
  return paged(
    docs.map((d) => ({ ...userView(d), productCount: byId.get(String(d._id)) ?? 0 })),
    total,
    page,
    limit,
  );
}

export async function setSellerApproval(id, approvalStatus) {
  const seller = await User.findOne({ _id: id, role: 'seller' });
  if (!seller) throw new ApiError(404, 'SELLER_NOT_FOUND', 'Seller not found');
  if (seller.seller?.approvalStatus === approvalStatus) return { seller, changed: false };

  const updated = await User.findByIdAndUpdate(
    id,
    { $set: { 'seller.approvalStatus': approvalStatus } },
    { new: true },
  );
  if (approvalStatus === 'rejected') await hideSellerProducts(id, 'seller_rejected');
  else await restoreSellerProducts(id, 'seller_rejected');
  return { seller: updated, changed: true };
}

// ---------- products ----------

const productView = (p) => ({
  id: String(p._id),
  title: p.title,
  price: p.price,
  stock: p.stock,
  status: p.status,
  hiddenReason: p.hiddenReason ?? null,
  image: p.images[0]?.url ?? null,
  category: p.categoryId?.name ? { name: p.categoryId.name, slug: p.categoryId.slug } : null,
  seller: { id: String(p.sellerId?._id ?? p.sellerId), businessName: p.sellerId?.seller?.businessName ?? null },
  avgRating: p.avgRating,
  reviewCount: p.reviewCount,
  createdAt: p.createdAt,
});

export async function listAdminProducts({ q, status, sellerId, page, limit }) {
  const filter = { ...search(q, ['title']), ...(status && { status }), ...(sellerId && { sellerId }) };
  const [docs, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('categoryId', 'name slug')
      .populate('sellerId', 'seller.businessName'),
    Product.countDocuments(filter),
  ]);
  return paged(docs.map(productView), total, page, limit);
}

export async function setProductStatus(id, status) {
  const update =
    status === 'hidden'
      ? { $set: { status, hiddenReason: 'admin' } }
      : { $set: { status }, $unset: { hiddenReason: '' } };
  const product = await Product.findByIdAndUpdate(id, update, { new: true })
    .populate('categoryId', 'name slug')
    .populate('sellerId', 'seller.businessName');
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return productView(product);
}

export async function deleteAnyProduct(id) {
  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  await removeProduct(product);
  return product;
}

// ---------- review moderation ----------

const flaggedView = (r) => ({
  id: String(r._id),
  rating: r.rating,
  text: r.text,
  spamScore: r.spamScore,
  spamReasons: r.spamReasons,
  sentiment: r.analysisStatus === 'done' ? r.sentiment : null,
  analysisStatus: r.analysisStatus,
  author: { id: String(r.authorId?._id), name: r.authorId?.name, email: r.authorId?.email },
  product: { id: String(r.productId?._id), title: r.productId?.title },
  createdAt: r.createdAt,
});

export async function listFlaggedReviews({ page, limit }) {
  const filter = { status: 'flagged' };
  const [docs, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: 1, _id: 1 }) // oldest first: the queue is worked from the top
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('authorId', 'name email')
      .populate('productId', 'title'),
    Review.countDocuments(filter),
  ]);
  return paged(docs.map(flaggedView), total, page, limit);
}

export async function moderateReview(id, action) {
  const review = await Review.findById(id);
  if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
  if (action === 'approve') {
    if (review.status !== 'flagged') throw new ApiError(409, 'NOT_FLAGGED', 'Only flagged reviews can be approved');
    review.status = 'published';
  } else {
    if (review.status === 'removed') throw new ApiError(409, 'ALREADY_REMOVED', 'Review is already removed');
    review.status = 'removed';
  }
  review.moderatedAt = new Date(); // automatic checks never overrule an admin decision
  await review.save();
  await recomputeProductStats(review.productId);
  return review;
}

// ---------- audit log ----------

export async function listAuditLog({ action, page, limit }) {
  const filter = action ? { action } : {};
  const [docs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('actorId', 'name email'),
    AuditLog.countDocuments(filter),
  ]);
  return paged(
    docs.map((a) => ({
      id: String(a._id),
      action: a.action,
      actor: { id: String(a.actorId?._id), name: a.actorId?.name, email: a.actorId?.email },
      targetType: a.targetType ?? null,
      targetId: a.targetId ? String(a.targetId) : null,
      meta: a.meta ?? null,
      ip: a.ip ?? null,
      createdAt: a.createdAt,
    })),
    total,
    page,
    limit,
  );
}
