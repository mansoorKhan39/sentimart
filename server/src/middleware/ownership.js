import { asyncHandler } from '../utils/asyncHandler.js';
import { getOwnedProduct } from '../services/product.service.js';

// 404 if the product does not exist, 403 if it belongs to another seller.
export const loadOwnedProduct = asyncHandler(async (req, _res, next) => {
  req.product = await getOwnedProduct(req.params.id, req.user.id);
  next();
});
