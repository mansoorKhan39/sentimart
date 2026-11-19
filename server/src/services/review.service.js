import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  BURST_MAX,
  BURST_WINDOW_MS,
  DUPLICATE_MIN_LENGTH,
  LAZY_RETRY_TIMEOUT_MS,
  MAX_ANALYSIS_ATTEMPTS,
  RETRY_MIN_AGE_MS,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { emit } from '../events/emitter.js';
import '../events/listeners.js';
import { Product } from '../models/product.model.js';
import { Review } from '../models/review.model.js';
import { SubOrder } from '../models/subOrder.model.js';
import { ApiError } from '../utils/ApiError.js';
import { analyzeText } from './nlp.service.js';

const DAY = 86_400_000;

// ---------- small pure helpers (unit tested) ----------

export const normalizeText = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const textKeyOf = (text) =>
  crypto.createHash('sha1').update(normalizeText(text)).digest('hex');

// Two independent spam signals become one score: 1 - (1 - a)(1 - b).
export const mergeSpam = (a, b) => Math.round((1 - (1 - a) * (1 - b)) * 1000) / 1000;

// "Ali Khan" -> "Ali K." (no full names of customers on a public page)
export function reviewerName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
  return `${parts[0]}${initial}`;
}

export function reviewView(review) {
  const analyzed = review.analysisStatus === 'done' && review.sentiment?.label;
  return {
    id: String(review._id),
    productId: String(review.productId),
    rating: review.rating,
    text: review.text,
    sentiment: analyzed
      ? {
          label: review.sentiment.label,
          score: review.sentiment.score,
          keywords: review.sentiment.keywords ?? [],
        }
      : null,
    analysisStatus: review.analysisStatus,
    status: review.status,
    author: { name: reviewerName(review.authorId?.name) },
    reply: review.reply?.text ? { text: review.reply.text, at: review.reply.at } : null,
    createdAt: review.createdAt,
    editedAt: review.editedAt ?? null,
  };
}

// ---------- spam checks that need the database (the NLP service has no review history) ----------

async function historyChecks({ authorId, text, excludeId }) {
  const reasons = [];
  let score = 0;
  const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  const textKey = textKeyOf(text);

  if (normalizeText(text).length >= DUPLICATE_MIN_LENGTH) {
    const copy = await Review.exists({ textKey, status: { $ne: 'removed' }, ...notSelf });
    if (copy) {
      score = mergeSpam(score, 0.85);
      reasons.push('duplicate_text');
    }
  }
  const recent = await Review.countDocuments({
    authorId,
    createdAt: { $gte: new Date(Date.now() - BURST_WINDOW_MS) },
    ...notSelf,
  });
  if (recent >= BURST_MAX) {
    score = mergeSpam(score, 0.8);
    reasons.push('burst_posting');
  }
  return { score, reasons, textKey };
}

// Runs the history checks and the NLP service, then fills the review document (not saved here).
async function analyzeAndApply(review, { timeoutMs } = {}) {
  const history = await historyChecks({
    authorId: review.authorId,
    text: review.text,
    excludeId: review._id,
  });
  const nlp = await analyzeText({ text: review.text, rating: review.rating }, { timeoutMs });

  review.textKey = history.textKey;
  review.lastAnalysisAt = new Date();
  review.analysisAttempts += 1;
  if (nlp) {
    review.sentiment = { label: nlp.label, score: nlp.score, keywords: nlp.keywords };
    review.analysisStatus = 'done';
    review.spamScore = mergeSpam(nlp.spamScore, history.score);
    review.spamReasons = [...new Set([...nlp.spamReasons, ...history.reasons])];
  } else {
    review.sentiment = undefined;
    review.analysisStatus = 'pending';
    review.spamScore = history.score;
    review.spamReasons = history.reasons;
  }
  // An admin decision (moderatedAt) or a removal is never overwritten by automatic checks.
  if (review.status !== 'removed' && !review.moderatedAt) {
    review.status = review.spamScore >= env.SPAM_THRESHOLD ? 'flagged' : 'published';
  }
  return Boolean(nlp);
}

// Recomputes the numbers shown on the product from its published reviews. Safe to run any time.
export async function recomputeProductStats(productId) {
  const count = (label) => ({ $sum: { $cond: [{ $eq: ['$sentiment.label', label] }, 1, 0] } });
  const [row] = await Review.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(String(productId)), status: 'published' } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avgRating: { $avg: '$rating' },
        positive: count('positive'),
        neutral: count('neutral'),
        negative: count('negative'),
        analyzed: { $sum: { $cond: [{ $eq: ['$analysisStatus', 'done'] }, 1, 0] } },
        scoreSum: { $sum: { $cond: [{ $eq: ['$analysisStatus', 'done'] }, '$sentiment.score', 0] } },
      },
    },
  ]);
  const stats = row ?? { count: 0, avgRating: 0, positive: 0, neutral: 0, negative: 0, analyzed: 0, scoreSum: 0 };
  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        avgRating: Math.round(stats.avgRating * 100) / 100,
        reviewCount: stats.count,
        sentiment: {
          positive: stats.positive,
          neutral: stats.neutral,
          negative: stats.negative,
          avgScore: stats.analyzed ? Math.round((stats.scoreSum / stats.analyzed) * 1000) / 1000 : 0,
        },
      },
    },
  );
}

// ---------- eligibility ----------

// A customer may review a product once per delivered package (SRS FR-24, AC-REVIEW).
async function findReviewablePackage(userId, productId) {
  const delivered = await SubOrder.find({
    customerId: userId,
    status: 'Delivered',
    'items.productId': productId,
  })
    .select('_id')
    .lean();
  if (delivered.length === 0) {
    throw new ApiError(403, 'NOT_ELIGIBLE', 'You can review a product after it has been delivered to you');
  }
  const reviewed = await Review.find({ productId, subOrderId: { $in: delivered.map((s) => s._id) } })
    .select('subOrderId')
    .lean();
  const used = new Set(reviewed.map((r) => String(r.subOrderId)));
  const free = delivered.find((s) => !used.has(String(s._id)));
  if (!free) throw new ApiError(409, 'ALREADY_REVIEWED', 'You have already reviewed this product');
  return free;
}

export async function getEligibility(userId, productId) {
  try {
    await findReviewablePackage(userId, productId);
    return { eligible: true, reason: null };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { eligible: false, reason: err.code === 'ALREADY_REVIEWED' ? 'already_reviewed' : 'not_delivered' };
  }
}

// ---------- create, edit, delete ----------

export async function createReview(userId, productId, { rating, text }) {
  const product = await Product.findById(productId).select('title sellerId');
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const pkg = await findReviewablePackage(userId, productId);

  const review = new Review({ productId, authorId: userId, subOrderId: pkg._id, rating, text });
  await analyzeAndApply(review);
  try {
    await review.save();
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, 'ALREADY_REVIEWED', 'You have already reviewed this product');
    throw err;
  }
  if (review.status === 'published') await recomputeProductStats(productId);
  // Awaited, not fire-and-forget: a serverless function can be frozen right after the response.
  await emit('review.created', { review, product });
  return review;
}

async function loadOwnReview(userId, reviewId) {
  const review = await Review.findOne({ _id: reviewId, authorId: userId, status: { $ne: 'removed' } });
  if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
  if (Date.now() - review.createdAt.getTime() > env.REVIEW_EDIT_DAYS * DAY) {
    throw new ApiError(409, 'EDIT_WINDOW_CLOSED', `Reviews can only be changed within ${env.REVIEW_EDIT_DAYS} days`);
  }
  return review;
}

export async function updateReview(userId, reviewId, changes) {
  const review = await loadOwnReview(userId, reviewId);
  if (changes.rating !== undefined) review.rating = changes.rating;
  if (changes.text !== undefined) review.text = changes.text;
  review.editedAt = new Date();
  review.moderatedAt = undefined; // new content: the automatic checks decide again
  review.analysisAttempts = 0;
  await analyzeAndApply(review);
  await review.save();
  await recomputeProductStats(review.productId);
  return review;
}

export async function deleteReview(userId, reviewId) {
  const review = await loadOwnReview(userId, reviewId);
  await review.deleteOne();
  await recomputeProductStats(review.productId);
}

// ---------- public list ----------

// Pending reviews of this product are retried lazily when someone reads the list (at most once a
// minute per review, with a short timeout, so a sleeping NLP service never slows the page for long).
async function lazyRetry(productId) {
  await retryPending({ productId, limit: 2, timeoutMs: LAZY_RETRY_TIMEOUT_MS });
}

export async function listProductReviews(productId, { sentiment, page, limit }) {
  const product = await Product.findOne({ _id: productId, status: 'active' }).select('avgRating reviewCount sentiment');
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  await lazyRetry(productId);

  const filter = {
    productId,
    status: 'published',
    ...(sentiment && { analysisStatus: 'done', 'sentiment.label': sentiment }),
  };
  const [docs, total, fresh, byRating] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('authorId', 'name'),
    Review.countDocuments(filter),
    Product.findById(productId).select('avgRating reviewCount sentiment'),
    Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(String(productId)), status: 'published' } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);
  const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of byRating) ratings[row._id] = row.count;
  const summary = fresh ?? product;
  return {
    items: docs.map(reviewView),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    summary: {
      avgRating: summary.avgRating,
      reviewCount: summary.reviewCount,
      ratings,
      sentiment: summary.sentiment,
    },
  };
}

// ---------- seller reply ----------

export async function replyToReview(sellerId, reviewId, text) {
  const review = await Review.findOne({ _id: reviewId, status: { $ne: 'removed' } }).populate('authorId', 'name');
  if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
  const product = await Product.findById(review.productId).select('sellerId');
  if (!product || String(product.sellerId) !== String(sellerId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only reply to reviews of your own products');
  }
  review.reply = { text, at: new Date() };
  await review.save();
  return review;
}

// ---------- retry of pending analysis (cron and lazy) ----------

export async function retryPending({
  limit = 20,
  minAgeMs = RETRY_MIN_AGE_MS,
  productId,
  timeoutMs,
} = {}) {
  const filter = {
    analysisStatus: 'pending',
    analysisAttempts: { $lt: MAX_ANALYSIS_ATTEMPTS },
    status: { $ne: 'removed' },
    $or: [{ lastAnalysisAt: { $exists: false } }, { lastAnalysisAt: { $lte: new Date(Date.now() - minAgeMs) } }],
    ...(productId && { productId }),
  };
  const reviews = await Review.find(filter).sort({ createdAt: 1 }).limit(limit);
  const touched = new Set();
  let analyzed = 0;
  for (const review of reviews) {
    const ok = await analyzeAndApply(review, { timeoutMs });
    await review.save();
    touched.add(String(review.productId));
    if (!ok) break; // the NLP service is down: stop here, try again at the next run
    analyzed += 1;
  }
  for (const id of touched) await recomputeProductStats(id);
  return { checked: reviews.length, analyzed };
}
