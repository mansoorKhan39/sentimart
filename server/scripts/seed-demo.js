/* eslint-disable no-console */
// Fills the database with realistic demo activity (customers, orders over 90 days, reviews with
// sentiment, flagged spam, pending seller applications) so the dashboards and charts have data.
// Run `npm run seed:catalog` first. Usage: npm run seed:demo   (add -- --reset to rebuild)
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import { Category } from '../src/models/category.model.js';
import { Order } from '../src/models/order.model.js';
import { Product } from '../src/models/product.model.js';
import { Review } from '../src/models/review.model.js';
import { SubOrder } from '../src/models/subOrder.model.js';
import { User } from '../src/models/user.model.js';
import { recomputeProductStats, textKeyOf } from '../src/services/review.service.js';
import { slugify } from '../src/utils/strings.js';

const DOMAIN = '@demo.sentimart.test';
const DAY = 86_400_000;
const NOW = Date.now();

// Small seeded random generator: the same demo data every time.
let state = 2026;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + rand() * (b - a);
const chance = (p) => rand() < p;

const CUSTOMERS = ['Ayesha Khan', 'Bilal Ahmed', 'Hira Malik', 'Usman Tariq', 'Sana Iqbal', 'Daniyal Raza',
  'Maryam Siddiqui', 'Hamza Sheikh', 'Zainab Ali', 'Fahad Mirza', 'Noor Fatima', 'Talha Butt', 'Iqra Javed', 'Saad Qureshi'];

const POSITIVE = [
  'Excellent quality, works perfectly and arrived earlier than expected.',
  'Really happy with this purchase, it feels premium and looks great.',
  'Great value for the price, I would happily buy it again.',
  'Packaging was neat and the product is exactly as described.',
  'Absolutely love it, fast delivery and the seller was very helpful.',
  'Does everything I needed and more, five stars from me.',
];
const NEUTRAL = [
  'It is okay for the price, nothing special but it does the job.',
  'Average product. Delivery was on time, quality is acceptable.',
  'Fine overall, a few small things could be better.',
];
// [text, keywords] so the seller "top complaints" chart has real themes
const NEGATIVE = [
  ['The battery died within two days and the charger stopped working.', ['battery', 'not working']],
  ['Delivery was very slow and the packaging arrived damaged.', ['slow delivery', 'packaging']],
  ['Terrible quality, it broke after a week of normal use.', ['broke', 'poor quality']],
  ['Size runs small and the fit is nothing like the photos.', ['size', 'fit']],
  ['Very noisy and it keeps disconnecting, not worth the price.', ['noisy', 'overpriced']],
  ['The colour faded after the first wash, very disappointed.', ['color fade', 'poor quality']],
  ['Stopped working after three days, support never replied.', ['not working', 'support']],
];
const SPAM = [
  'Best prices! Visit my shop www.cheap-deals.example and use discount code SAVE50 now!!!',
  'Earn money from home, click here and DM me on WhatsApp +92 300 1234567',
  'Buy now limited offer follow me for free gift www.promo-links.example',
];
const REPLIES = [
  'Thank you for the feedback, we are sorry about this and will make it right.',
  'We appreciate your review! Please contact us so we can help.',
  'Thanks for shopping with us, glad you liked it!',
];
const PLACEHOLDER = (title) => `https://placehold.co/600x600/1a1d27/e6b84a?text=${encodeURIComponent(title)}`;

async function resetDemo() {
  const users = await User.find({ email: new RegExp(`${DOMAIN.replace('.', '\\.')}$`) }).select('_id role');
  const ids = users.map((u) => u._id);
  const sellerIds = users.filter((u) => u.role === 'seller').map((u) => u._id);
  const r = await Promise.all([
    Review.deleteMany({ authorId: { $in: ids } }),
    SubOrder.deleteMany({ customerId: { $in: ids } }),
    Order.deleteMany({ customerId: { $in: ids } }),
    Product.deleteMany({ sellerId: { $in: sellerIds } }),
    User.deleteMany({ _id: { $in: ids } }),
  ]);
  console.log(`Removed demo data (${r[0].deletedCount} reviews, ${r[2].deletedCount} orders, ${ids.length} users).`);
  for (const product of await Product.find().select('_id')) await recomputeProductStats(product._id);
}

await connectDB();
if (process.argv.includes('--reset')) await resetDemo();

if (await User.exists({ email: `customer1${DOMAIN}` })) {
  console.log('Demo data already exists. Run with "-- --reset" to rebuild it.');
  await mongoose.disconnect();
  process.exit(0);
}
const baseProducts = await Product.find({ status: 'active' });
if (baseProducts.length === 0) {
  console.log('No products found. Run "npm run seed:catalog" first.');
  await mongoose.disconnect();
  process.exit(1);
}

// ---------- users ----------
const password = `Demo-${crypto.randomBytes(6).toString('base64url')}1a`;
const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
const customers = await User.insertMany(
  CUSTOMERS.map((name, i) => ({
    name, email: `customer${i + 1}${DOMAIN}`, passwordHash, role: 'customer',
    addresses: [{ label: 'Home', line1: `${10 + i} Main Boulevard`, city: pick(['Islamabad', 'Lahore', 'Karachi', 'Rawalpindi']) }],
  })),
);
const sellerDoc = (businessName, handle, approvalStatus) => ({
  name: businessName, email: `${handle}${DOMAIN}`, passwordHash, role: 'seller',
  seller: { businessName, approvalStatus },
});
const [techHub] = await User.insertMany([
  sellerDoc('Tech Hub', 'techhub', 'approved'),
  sellerDoc('Glow Studio', 'glowstudio', 'pending'),
  sellerDoc('Urban Threads', 'urbanthreads', 'pending'),
]);
const cat = async (name) => (await Category.findOne({ slug: slugify(name) }))?._id ?? baseProducts[0].categoryId;
const techHubSpecs = [
  ['Mechanical Keyboard', 1299900, 35, 'Electronics', 'Hot-swappable mechanical keyboard with tactile switches and RGB lighting.'],
  ['27 Inch Monitor', 4599900, 12, 'Electronics', 'Full HD IPS monitor with a 75Hz refresh rate and thin bezels.'],
  ['Laptop Stand', 399900, 4, 'Electronics', 'Adjustable aluminium laptop stand that improves posture and airflow.'],
  ['Webcam 1080p', 599900, 0, 'Electronics', 'Full HD webcam with a built-in microphone and privacy shutter.'],
];
const techHubProducts = await Product.insertMany(
  await Promise.all(
    techHubSpecs.map(async ([title, price, stock, category, description]) => ({
      sellerId: techHub._id,
      categoryId: await cat(category),
      title,
      description,
      price,
      stock,
      images: [{ url: PLACEHOLDER(title), publicId: `seed:${slugify(title)}` }],
    })),
  ),
);
const products = [...baseProducts, ...techHubProducts];

// ---------- orders and packages over 90 days ----------
const orders = [];
const packages = [];
for (let i = 0; i < 95; i += 1) {
  const customer = pick(customers);
  const daysAgo = Math.floor(rand() ** 1.4 * 90) + (chance(0.5) ? 1 : 0);
  const createdAt = new Date(NOW - daysAgo * DAY - between(1, 12) * 3_600_000);
  const lines = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(products)))];
  const orderId = new mongoose.Types.ObjectId();

  const bySeller = new Map();
  for (const product of lines) {
    const key = String(product.sellerId);
    if (!bySeller.has(key)) bySeller.set(key, []);
    bySeller.get(key).push({ productId: product._id, title: product.title, price: product.price, qty: 1 + Math.floor(rand() * 2) });
  }
  const ageDays = (NOW - createdAt.getTime()) / DAY;
  const subIds = [];
  let total = 0;
  for (const [sellerId, items] of bySeller) {
    const roll = rand();
    const status =
      ageDays > 8 ? (roll < 0.86 ? 'Delivered' : roll < 0.95 ? 'Cancelled' : 'Shipped')
        : ageDays > 3 ? (roll < 0.4 ? 'Delivered' : roll < 0.8 ? 'Shipped' : 'Confirmed')
          : roll < 0.5 ? 'Pending' : roll < 0.8 ? 'Confirmed' : 'Shipped';
    const flow = status === 'Cancelled' ? ['Pending', 'Cancelled'] : ['Pending', 'Confirmed', 'Shipped', 'Delivered'].slice(0, ['Pending', 'Confirmed', 'Shipped', 'Delivered'].indexOf(status) + 1);
    const history = flow.map((s, step) => ({ status: s, at: new Date(Math.min(NOW, createdAt.getTime() + step * between(0.4, 1.2) * DAY)) }));
    const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
    const _id = new mongoose.Types.ObjectId();
    subIds.push(_id);
    total += subtotal;
    packages.push({
      _id, orderId, customerId: customer._id, sellerId: new mongoose.Types.ObjectId(sellerId), items, subtotal,
      status, statusHistory: history, createdAt, updatedAt: history.at(-1).at,
    });
  }
  orders.push({
    _id: orderId, customerId: customer._id, address: customer.addresses[0], paymentMethod: chance(0.75) ? 'COD' : 'TEST_CARD',
    total, subOrderIds: subIds, createdAt,
  });
}
await Order.insertMany(orders);
await SubOrder.insertMany(packages);

// ---------- reviews ----------
const reviews = [];
const customerById = new Map(customers.map((c) => [String(c._id), c]));
const used = new Set();
const sellerReplies = (negative) => (chance(negative ? 0.55 : 0.15) ? { text: pick(REPLIES), at: new Date(NOW - between(0, 6) * DAY) } : undefined);
// some products are simply worse than others, which makes the sentiment charts interesting
const badProducts = new Set(products.filter((_, i) => i % 5 === 3).map((p) => String(p._id)));

for (const pkg of packages.filter((p) => p.status === 'Delivered')) {
  const deliveredAt = pkg.statusHistory.at(-1).at.getTime();
  for (const item of pkg.items) {
    if (!chance(0.6)) continue;
    const bad = badProducts.has(String(item.productId));
    const roll = rand();
    const label = roll < (bad ? 0.35 : 0.64) ? 'positive' : roll < (bad ? 0.5 : 0.8) ? 'neutral' : 'negative';
    const createdAt = new Date(Math.min(NOW - 3_600_000, deliveredAt + between(1, 6) * DAY));
    const key = `${item.productId}:${pkg._id}`;
    if (used.has(key)) continue;
    used.add(key);
    let text; let keywords = [];
    let score; let rating;
    if (label === 'positive') { text = `${pick(POSITIVE)} ${pick(['', 'Highly recommended.', 'Worth every rupee.'])}`.trim(); score = between(0.35, 0.92); rating = chance(0.7) ? 5 : 4; keywords = text.toLowerCase().match(/quality|delivery|value|packaging|premium/g)?.slice(0, 3) ?? []; }
    else if (label === 'neutral') { text = pick(NEUTRAL); score = between(-0.04, 0.04); rating = 3; keywords = ['average']; }
    else { const [t, k] = pick(NEGATIVE); text = t; keywords = k; score = between(-0.9, -0.3); rating = chance(0.6) ? 1 : 2; }
    text = `${text} (${item.title})`;
    reviews.push({
      productId: item.productId, authorId: pkg.customerId, subOrderId: pkg._id, rating, text, textKey: textKeyOf(text),
      sentiment: { label, score: Number(score.toFixed(3)), keywords: [...new Set(keywords)] },
      analysisStatus: 'done', analysisAttempts: 1, lastAnalysisAt: createdAt, spamScore: Number(between(0, 0.12).toFixed(3)),
      status: 'published', reply: sellerReplies(label === 'negative'), createdAt, updatedAt: createdAt,
    });
  }
}
// a few reviews waiting for analysis (shows the "analysing" state) and a spam queue for the admin
const delivered = packages.filter((p) => p.status === 'Delivered');
const extra = (index, patch) => {
  const pkg = delivered[(index * 7) % delivered.length];
  const item = pkg.items[0];
  const key = `${item.productId}:${pkg._id}`;
  if (used.has(key)) return;
  used.add(key);
  const createdAt = new Date(NOW - between(0.2, 2) * DAY);
  const text = patch.text ?? `Arrived well packed and works as described. (${item.title})`;
  reviews.push({
    productId: item.productId, authorId: pkg.customerId, subOrderId: pkg._id, rating: patch.rating ?? 5, text, textKey: textKeyOf(text),
    createdAt, updatedAt: createdAt, analysisStatus: 'done', analysisAttempts: 1, lastAnalysisAt: createdAt, ...patch,
  });
};
for (let i = 0; i < 3; i += 1) extra(i, { analysisStatus: 'pending', analysisAttempts: 1, status: 'published', spamScore: 0.02, spamReasons: [], text: `Good product, delivery was quick and support answered fast ${i}.` });
SPAM.forEach((text, i) => extra(10 + i, {
  text, rating: 5, status: 'flagged', spamScore: 0.9, spamReasons: ['link', 'promo_phrase'],
  sentiment: { label: 'positive', score: 0.7, keywords: ['prices'] },
}));
extra(20, { text: 'Excellent quality, works perfectly and arrived earlier than expected.', status: 'flagged', spamScore: 0.86, spamReasons: ['duplicate_text'], sentiment: { label: 'positive', score: 0.8, keywords: ['quality'] } });
await Review.insertMany(reviews, { ordered: false });
for (const product of products) await recomputeProductStats(product._id);

console.log(`Demo data created: ${customers.length} customers, ${orders.length} orders (${packages.length} packages), ${reviews.length} reviews.`);
console.log(`Logins (same password for all demo accounts): ${password}`);
console.log(`  customers: customer1${DOMAIN} ... customer${customers.length}${DOMAIN}`);
console.log(`  seller with data: techhub${DOMAIN}   pending applications: glowstudio${DOMAIN}, urbanthreads${DOMAIN}`);
console.log('  the catalog seller (seller@example.com) now has orders and reviews too.');
await mongoose.disconnect();
