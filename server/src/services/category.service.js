import { Category } from '../models/category.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import { slugify } from '../utils/strings.js';

function buildSlug(name) {
  const slug = slugify(name);
  if (!slug) throw new ApiError(422, 'VALIDATION_ERROR', 'Name must contain letters or digits');
  return slug;
}

const duplicate = (err) => {
  if (err?.code === 11000) throw new ApiError(409, 'CATEGORY_EXISTS', 'Category already exists');
  throw err;
};

export async function listCategories() {
  const categories = await Category.find().sort({ name: 1 });
  return categories.map((c) => c.toPublic());
}

export async function createCategory({ name }) {
  try {
    return (await Category.create({ name, slug: buildSlug(name) })).toPublic();
  } catch (err) {
    return duplicate(err);
  }
}

export async function updateCategory(id, { name }) {
  try {
    const category = await Category.findByIdAndUpdate(
      id,
      { $set: { name, slug: buildSlug(name) } },
      { new: true, runValidators: true },
    );
    if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    return category.toPublic();
  } catch (err) {
    return duplicate(err);
  }
}

export async function deleteCategory(id) {
  if (await Product.exists({ categoryId: id })) {
    throw new ApiError(409, 'CATEGORY_IN_USE', 'Category still has products');
  }
  const deleted = await Category.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
}
