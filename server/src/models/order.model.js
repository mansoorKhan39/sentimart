import mongoose from 'mongoose';
import { PAYMENT_METHODS } from '../config/constants.js';

const { Schema } = mongoose;

const addressSchema = new Schema(
  {
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    address: { type: addressSchema, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    total: { type: Number, required: true, min: 0 }, // minor units (paisa)
    subOrderIds: [{ type: Schema.Types.ObjectId, ref: 'SubOrder' }],
  },
  { timestamps: true },
);

orderSchema.index({ customerId: 1, createdAt: -1 });

export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
