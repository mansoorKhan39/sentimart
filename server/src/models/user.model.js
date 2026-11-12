import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  label: { type: String, trim: true, maxlength: 30 },
  line1: { type: String, required: true, trim: true, maxlength: 200 },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, trim: true, maxlength: 20 },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['customer', 'seller', 'admin'], default: 'customer' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    seller: {
      businessName: { type: String, trim: true, maxlength: 120 },
      approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'] },
    },
    addresses: { type: [addressSchema], default: [] },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    // login lockout (SRS NFR-13)
    failedLogins: { type: Number, default: 0, select: false },
    firstFailAt: { type: Date, select: false },
    lockedUntil: { type: Date, select: false },
    // password reset (single use, hashed)
    resetTokenHash: { type: String, select: false },
    resetExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, status: 1 });

userSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    ...(this.role === 'seller' && {
      seller: {
        businessName: this.seller?.businessName,
        approvalStatus: this.seller?.approvalStatus,
      },
    }),
    addresses: this.addresses,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
