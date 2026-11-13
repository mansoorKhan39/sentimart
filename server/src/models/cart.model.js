import mongoose from 'mongoose';
import { MAX_CART_QTY } from '../config/constants.js';

const { Schema } = mongoose;

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        qty: { type: Number, required: true, min: 1, max: MAX_CART_QTY },
      },
    ],
  },
  { timestamps: true },
);

export const Cart = mongoose.models.Cart || mongoose.model('Cart', cartSchema);
