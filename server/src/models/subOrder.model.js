import mongoose from 'mongoose';
import { SUB_ORDER_STATUSES } from '../config/constants.js';

const { Schema } = mongoose;

const subOrderSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Snapshot at purchase time: later price or title changes never rewrite history.
    items: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        title: { type: String, required: true },
        price: { type: Number, required: true, min: 1 },
        qty: { type: Number, required: true, min: 1 },
      },
    ],
    subtotal: { type: Number, required: true, min: 0 },
    status: { type: String, enum: SUB_ORDER_STATUSES, default: 'Pending' },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: SUB_ORDER_STATUSES, required: true },
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true },
);

subOrderSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
subOrderSchema.index({ orderId: 1 });
subOrderSchema.index({ customerId: 1, createdAt: -1 });

export const SubOrder = mongoose.models.SubOrder || mongoose.model('SubOrder', subOrderSchema);
