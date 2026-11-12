import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { RefreshToken } from '../models/refreshToken.model.js';
import { ApiError } from '../utils/ApiError.js';
import { randomToken, sha256, signAccessToken } from '../utils/tokens.js';
import { resetPasswordEmail, sendEmail, welcomeEmail } from './email.service.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
// Compared against when the email is unknown, so timing does not reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function register({ name, email, password, role, businessName }) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  try {
    const user = await User.create({
      name,
      email,
      passwordHash,
      role,
      ...(role === 'seller' && { seller: { businessName, approvalStatus: 'pending' } }),
    });
    await sendEmail(welcomeEmail(user));
    return user;
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, 'EMAIL_TAKEN', 'Email is already registered');
    throw err;
  }
}

async function recordFailure(user, now) {
  const windowMs = env.LOGIN_WINDOW_MIN * MINUTE;
  const fresh = !user.firstFailAt || now - user.firstFailAt > windowMs;
  const count = fresh ? 1 : user.failedLogins + 1;
  const update = { failedLogins: count, firstFailAt: fresh ? now : user.firstFailAt };
  if (count >= env.LOGIN_MAX_FAILS) update.lockedUntil = new Date(now.getTime() + windowMs);
  await User.updateOne({ _id: user._id }, { $set: update });
}

async function issueSession(user) {
  const refreshToken = randomToken();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * DAY),
  });
  return { accessToken: signAccessToken(user), refreshToken, user: user.toPublic() };
}

export async function login({ email, password }) {
  const now = new Date();
  const user = await User.findOne({ email }).select(
    '+passwordHash +failedLogins +firstFailAt +lockedUntil',
  );

  if (user?.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil - now) / MINUTE);
    throw new ApiError(
      429,
      'TOO_MANY_ATTEMPTS',
      `Too many failed attempts. Try again in ${minutes} minute(s).`,
    );
  }

  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    if (user) await recordFailure(user, now);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');

  if (user.failedLogins > 0 || user.lockedUntil) {
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLogins: 0 }, $unset: { firstFailAt: '', lockedUntil: '' } },
    );
  }
  return issueSession(user);
}

// Rotation with reuse detection: replaying an old refresh token revokes the whole family.
export async function refresh(rawToken) {
  if (!rawToken) throw new ApiError(401, 'NO_REFRESH_TOKEN', 'Login required');
  const stored = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
  if (!stored) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Login required');

  if (stored.revoked) {
    await RefreshToken.updateMany(
      { userId: stored.userId, revoked: false },
      { $set: { revoked: true } },
    );
    throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Session expired, please log in again');
  }
  if (stored.expiresAt <= new Date()) {
    throw new ApiError(401, 'REFRESH_TOKEN_EXPIRED', 'Login required');
  }

  const user = await User.findById(stored.userId);
  if (!user) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Login required');
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');

  const next = randomToken();
  const swapped = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, revoked: false },
    { $set: { revoked: true, replacedByHash: sha256(next) } },
  );
  if (!swapped) {
    throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Session expired, please log in again');
  }

  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(next),
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * DAY),
  });
  return { accessToken: signAccessToken(user), refreshToken: next, user: user.toPublic() };
}

export async function logout(rawToken) {
  if (rawToken) {
    await RefreshToken.updateOne({ tokenHash: sha256(rawToken) }, { $set: { revoked: true } });
  }
}

// Returns the raw token (the controller ignores it; tests use it). Unknown emails
// produce no error and no email, so accounts cannot be enumerated.
export async function forgotPassword(email) {
  const user = await User.findOne({ email });
  if (!user || user.status !== 'active') return null;
  const token = randomToken(32);
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        resetTokenHash: sha256(token),
        resetExpires: new Date(Date.now() + env.RESET_TOKEN_TTL_MIN * MINUTE),
      },
    },
  );
  await sendEmail(resetPasswordEmail(user, `${env.CLIENT_ORIGIN}/reset-password/${token}`));
  return token;
}

export async function resetPassword(token, password) {
  const user = await User.findOne({
    resetTokenHash: sha256(token),
    resetExpires: { $gt: new Date() },
  }).select('+resetTokenHash +resetExpires');
  if (!user) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'Reset link is invalid or expired');

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash, failedLogins: 0 },
      $unset: { resetTokenHash: '', resetExpires: '', firstFailAt: '', lockedUntil: '' },
    },
  );
  await RefreshToken.updateMany({ userId: user._id, revoked: false }, { $set: { revoked: true } });
}
