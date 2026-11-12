import { ApiError } from '../utils/ApiError.js';

export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new ApiError(403, 'FORBIDDEN', 'You do not have access to this resource'));

export const requireApprovedSeller = (req, _res, next) =>
  req.user?.role === 'seller' && req.user.sellerApproval === 'approved'
    ? next()
    : next(new ApiError(403, 'SELLER_NOT_APPROVED', 'Seller account is not approved yet'));
