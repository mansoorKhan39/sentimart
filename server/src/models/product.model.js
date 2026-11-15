import mongoose from 'mongoose';
import { MAX_IMAGES_PER_PRODUCT } from '../config/constants.js';

const { Schema } = mongoose;
const isInteger = { validator: Number.isInteger, message: '{PATH} must be a whole number' };
const refId = (value) => String(value?._id ?? value);

const imageSchema = new Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
});

const productSchema = new Schema(
  {
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 4000 },
    price: { type: Number, required: true, min: 1, validate: isInteger }, // minor units (paisa)
    stock: { type: Number, required: true, min: 0, validate: isInteger },
    images: {
      type: [imageSchema],
      default: [],
      validate: {
        validator: (v) => v.length <= MAX_IMAGES_PER_PRODUCT,
        message: `At most ${MAX_IMAGES_PER_PRODUCT} images`,
      },
    },
    status: { type: String, enum: ['active', 'hidden'], default: 'active' },
    // why a product is hidden, so it can be restored automatically (e.g. seller re-approved)
    hiddenReason: { type: String, enum: ['admin', 'seller_rejected', 'seller_suspended'] },
    // maintained by the reviews module
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    sentiment: {
      positive: { type: Number, default: 0 },
      neutral: { type: Number, default: 0 },
      negative: { type: Number, default: 0 },
      avgScore: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

productSchema.index({ status: 1, categoryId: 1, price: 1 });
productSchema.index({ sellerId: 1 });
productSchema.index({ avgRating: -1 });
productSchema.index({ createdAt: -1 });

// Safe public shape: no publicId, no seller email. Works with populated or plain ids.
productSchema.methods.toPublic = function toPublic() {
  const category = this.categoryId?.name
    ? { id: refId(this.categoryId), name: this.categoryId.name, slug: this.categoryId.slug }
    : { id: refId(this.categoryId) };
  const seller = this.sellerId?.seller
    ? { id: refId(this.sellerId), businessName: this.sellerId.seller.businessName }
    : { id: refId(this.sellerId) };
  return {
    id: String(this._id),
    title: this.title,
    description: this.description,
    price: this.price,
    stock: this.stock,
    images: this.images.map((img) => ({ id: String(img._id), url: img.url })),
    category,
    seller,
    status: this.status,
    avgRating: this.avgRating,
    reviewCount: this.reviewCount,
    sentiment: this.sentiment,
    createdAt: this.createdAt,
  };
};

export const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
