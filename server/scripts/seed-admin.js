/* eslint-disable no-console */
// Creates the first admin account. Usage: npm run seed:admin
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/user.model.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 8) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars) in .env');
}

await connectDB();
const existing = await User.findOne({ email: email.toLowerCase() });
if (existing) {
  console.log(`Admin already exists: ${email}`);
} else {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  await User.create({ name: 'Admin', email, passwordHash, role: 'admin' });
  console.log(`Admin created: ${email}`);
}
await mongoose.disconnect();
