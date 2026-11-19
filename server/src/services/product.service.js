import { MAX_IMAGES_PER_PRODUCT } from '../config/constants.js';
import { Category } from '../models/category.model.js';
import { Product } from '../models/product.model.js';
import { ApiError } from '../utils/ApiError.js';
import { detectImageType } from '../utils/imageType.js';
import { escapeRegex } from '../utils/strings.js';
import { destroyImage, uploadImage } from './upload.service.js';

export const PUBLIC_POPULATE = [
  { path: 'categoryId', select: 'name slug' },
  { path: 'sellerId', select: 'seller.businessName' },
];

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: 1 },
  rating: { avgRating: -1, reviewCount: -1, _id: 1 },
};

// VADER convention: compound >= 0.05 positive, <= -0.05 negative.
const SENTIMENT_FILTERS = {
  positive: { 'sentiment.avgScore': { $gte: 0.05 } },
  negative: { 'sentiment.avgScore': { $lte: -0.05 } },
  neutral: { 'sentiment.avgScore': { $gt: -0.05, $lt: 0.05 } },
};

async function assertCategory(categoryId) {
  if (!(await Category.exists({ _id: categoryId }))) {
    throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
  }
}

const populated = (query) => query.populate(PUBLIC_POPULATE);

export async function createProduct(sellerId, body) {
  await assertCategory(body.categoryId);
  const product = await Product.create({ ...body, sellerId });
  return populated(Product.findById(product._id));
}

export async function listProducts(query) {
  const { q, category, minPrice, maxPrice, minRating, sentiment, sort, page, limit } = query;
  const filter = { status: 'active' };

  if (category) {
    const found = await Category.findOne({ slug: category }).select('_id');
    if (!found) return { items: [], page, limit, total: 0, totalPages: 0 };
    filter.categoryId = found._id;
  }
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: pattern }, { description: pattern }];
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {
      ...(minPrice !== undefined && { $gte: minPrice }),
      ...(maxPrice !== undefined && { $lte: maxPrice }),
    };
  }
  if (minRating !== undefined) filter.avgRating = { $gte: minRating };
  if (sentiment) Object.assign(filter, SENTIMENT_FILTERS[sentiment], { reviewCount: { $gt: 0 } });

  const [docs, total] = await Promise.all([
    populated(Product.find(filter).sort(SORTS[sort]).skip((page - 1) * limit).limit(limit)),
    Product.countDocuments(filter),
  ]);
  return {
    items: docs.map((d) => d.toPublic()),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getPublicProduct(id) {
  const product = await populated(Product.findOne({ _id: id, status: 'active' }));
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return product;
}

export async function getOwnedProduct(id, sellerId) {
  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (String(product.sellerId) !== String(sellerId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only change your own products');
  }
  return product;
}

export async function updateProduct(product, changes) {
  if (changes.categoryId) await assertCategory(changes.categoryId);
  return populated(
    Product.findByIdAndUpdate(product._id, { $set: changes }, { new: true, runValidators: true }),
  );
}

export async function deleteProduct(product) {
  await Product.deleteOne({ _id: product._id });
  await Promise.all(product.images.map((img) => destroyImage(img.publicId)));
}

export async function addImages(product, files) {
  if (!files?.length) throw new ApiError(422, 'UPLOAD_ERROR', 'Attach at least one image in the field "images"');
  const types = files.map((file) => detectImageType(file.buffer));
  if (types.includes(null)) {
    throw new ApiError(422, 'INVALID_IMAGE', 'Only JPEG, PNG or WebP images are allowed');
  }
  if (product.images.length + files.length > MAX_IMAGES_PER_PRODUCT) {
    throw new ApiError(409, 'IMAGE_LIMIT', `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
  }

  const uploaded = [];
  try {
    for (let i = 0; i < files.length; i += 1) {
      uploaded.push(await uploadImage(files[i].buffer, types[i]));
    }
  } catch (err) {
    await Promise.all(uploaded.map((img) => destroyImage(img.publicId)));
    throw err;
  }

  // Atomic limit check: two parallel uploads cannot push the product over the limit.
  const updated = await populated(
    Product.findOneAndUpdate(
      {
        _id: product._id,
        $expr: { $lte: [{ $add: [{ $size: '$images' }, uploaded.length] }, MAX_IMAGES_PER_PRODUCT] },
      },
      { $push: { images: { $each: uploaded } } },
      { new: true },
    ),
  );
  if (!updated) {
    await Promise.all(uploaded.map((img) => destroyImage(img.publicId)));
    throw new ApiError(409, 'IMAGE_LIMIT', `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
  }
  return updated;
}

export async function removeImage(product, imageId) {
  const image = product.images.id(imageId);
  if (!image) throw new ApiError(404, 'IMAGE_NOT_FOUND', 'Image not found');
  const updated = await populated(
    Product.findByIdAndUpdate(product._id, { $pull: { images: { _id: image._id } } }, { new: true }),
  );
  await destroyImage(image.publicId);
  return updated;
}
