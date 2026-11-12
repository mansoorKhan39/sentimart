import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/tokens.js';

// Verifies the Bearer token, then re-reads role/status from the DB so that a
// suspension or role change takes effect immediately.
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Login required');
  }
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  }
  const user = await User.findById(payload.sub).select('role status seller.approvalStatus');
  if (!user) throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  req.user = { id: String(user._id), role: user.role, sellerApproval: user.seller?.approvalStatus };
  next();
});
