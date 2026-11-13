import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 50 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 80 },
  },
  { timestamps: true },
);

categorySchema.methods.toPublic = function toPublic() {
  return { id: String(this._id), name: this.name, slug: this.slug };
};

export const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
