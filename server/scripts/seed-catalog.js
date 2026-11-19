/* eslint-disable no-console */
// Seeds sample categories and products. Safe to run again (skips what exists). Usage: npm run seed:catalog
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import { Category } from '../src/models/category.model.js';
import { Product } from '../src/models/product.model.js';
import { User } from '../src/models/user.model.js';
import { slugify } from '../src/utils/strings.js';

// [title, price in paisa, stock, description]
const CATALOG = {
  Electronics: [
    ['Wireless Mouse', 249900, 40, 'Ergonomic 2.4GHz wireless mouse with silent clicks and a 12 month battery.'],
    ['Bluetooth Headphones', 899900, 25, 'Over-ear Bluetooth headphones with deep bass and 30 hours of playback.'],
    ['USB-C Fast Charger', 349900, 60, '45W USB-C wall charger that fast-charges phones, tablets and laptops.'],
  ],
  Fashion: [
    ['Cotton Crew T-Shirt', 129900, 80, 'Soft 100 percent cotton t-shirt with a relaxed everyday fit.'],
    ['Slim Fit Denim Jeans', 349900, 35, 'Stretch denim jeans with a slim fit and reinforced stitching.'],
    ['Canvas Sneakers', 449900, 30, 'Lightweight canvas sneakers with a cushioned insole for daily wear.'],
  ],
  'Home & Kitchen': [
    ['Stainless Steel Water Bottle', 159900, 70, 'Double wall insulated bottle that keeps drinks cold for 24 hours.'],
    ['Non-stick Frying Pan', 279900, 45, 'Durable 28 cm non-stick frying pan that works on every stove type.'],
    ['LED Desk Lamp', 219900, 50, 'Dimmable LED desk lamp with three colour modes and a USB charging port.'],
  ],
  Books: [
    ['Clean Code', 459900, 20, 'A handbook of agile software craftsmanship by Robert C. Martin.'],
    ['Atomic Habits', 329900, 55, 'A practical guide to building good habits and breaking bad ones.'],
    ['The Pragmatic Programmer', 499900, 18, 'Your journey to mastery, a classic for every working developer.'],
  ],
  'Sports & Outdoors': [
    ['Yoga Mat', 189900, 65, 'Non-slip 6 mm yoga mat with a carrying strap, easy to clean.'],
    ['Adjustable Dumbbell Set', 699900, 15, 'Pair of adjustable dumbbells for home workouts, 2 to 10 kg each.'],
    ['Insulated Camping Mug', 99900, 90, 'Lightweight stainless steel camping mug with a locking lid.'],
  ],
  Beauty: [
    ['Vitamin C Face Serum', 289900, 40, 'Brightening serum with 15 percent vitamin C for an even skin tone.'],
    ['Hydrating Face Moisturizer', 239900, 50, 'Lightweight daily moisturizer with hyaluronic acid for all skin types.'],
    ['Sunscreen SPF 50', 199900, 75, 'Broad spectrum SPF 50 sunscreen with a non-greasy finish.'],
  ],
};

await connectDB();

let seller = await User.findOne({ email: 'seller@example.com' });
if (!seller) {
  const password = `${crypto.randomBytes(9).toString('base64url')}aA1`;
  seller = await User.create({
    name: 'Demo Seller',
    email: 'seller@example.com',
    passwordHash: await bcrypt.hash(password, env.BCRYPT_COST),
    role: 'seller',
    seller: { businessName: 'Demo Store', approvalStatus: 'approved' },
  });
  console.log(`Created demo seller seller@example.com with password: ${password} (shown once)`);
}

let created = 0;
for (const [categoryName, products] of Object.entries(CATALOG)) {
  const slug = slugify(categoryName);
  const category =
    (await Category.findOne({ slug })) || (await Category.create({ name: categoryName, slug }));
  for (const [title, price, stock, description] of products) {
    if (await Product.exists({ sellerId: seller._id, title })) continue;
    const imageUrl = `https://placehold.co/600x600/1a1d27/e6b84a?text=${encodeURIComponent(title)}`;
    await Product.create({
      sellerId: seller._id,
      categoryId: category._id,
      title,
      description,
      price,
      stock,
      images: [{ url: imageUrl, publicId: `seed:${slugify(title)}` }],
    });
    created += 1;
  }
}
console.log(`Done. ${created} products created, ${Object.keys(CATALOG).length} categories ready.`);
await mongoose.disconnect();
