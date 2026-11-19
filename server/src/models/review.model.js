import mongoose from 'mongoose';
import {
  REVIEW_STATUSES,
  REVIEW_TEXT_MAX,
  REVIEW_TEXT_MIN,
  SENTIMENT_LABELS,
} from '../config/constants.js';

const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // The delivered package this review is based on (one review per product per package).
    subOrderId: { type: Schema.Types.ObjectId, ref: 'SubOrder', required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: 'rating must be a whole number' },
    },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: REVIEW_TEXT_MIN,
      maxlength: REVIEW_TEXT_MAX,
    },
    textKey: { type: String }, // sha1 of the normalised text: finds copy-pasted reviews
    sentiment: {
      label: { type: String, enum: SENTIMENT_LABELS },
      score: { type: Number, min: -1, max: 1 },
      keywords: { type: [String], default: undefined },
    },
    // pending = the NLP service was unreachable; it is retried later (SRS FR-25).
    analysisStatus: { type: String, enum: ['pending', 'done'], default: 'pending' },
    analysisAttempts: { type: Number, default: 0 },
    lastAnalysisAt: { type: Date },
    spamScore: { type: Number, default: 0, min: 0, max: 1 },
    spamReasons: { type: [String], default: [] },
    status: { type: String, enum: REVIEW_STATUSES, default: 'published' },
    moderatedAt: { type: Date }, // set by an admin decision (Module 5): automatic checks no longer change the status
    reply: { text: { type: String, maxlength: 1000 }, at: { type: Date } },
    editedAt: { type: Date },
  },
  { timestamps: true },
);

reviewSchema.index({ productId: 1, subOrderId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ analysisStatus: 1, lastAnalysisAt: 1 });
reviewSchema.index({ authorId: 1, createdAt: -1 });
reviewSchema.index({ textKey: 1 });

export const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);
