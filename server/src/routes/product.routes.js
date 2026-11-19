import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireApprovedSeller } from '../middleware/rbac.js';
import { loadOwnedProduct } from '../middleware/ownership.js';
import { imageUpload } from '../middleware/upload.js';
import * as c from '../controllers/product.controller.js';
import { idParam } from '../validators/common.validators.js';
import {
  createProductSchema,
  listProductsSchema,
  productImageParams,
  updateProductSchema,
} from '../validators/catalog.validators.js';

const router = Router();
const seller = [requireAuth, requireApprovedSeller];

router.get('/', validate(listProductsSchema), h(c.list));
router.get('/:id', validate(idParam), h(c.getOne));

router.post('/', ...seller, validate(createProductSchema), h(c.create));
router.patch('/:id', ...seller, validate(updateProductSchema), loadOwnedProduct, h(c.update));
router.delete('/:id', ...seller, validate(idParam), loadOwnedProduct, h(c.remove));

// Ownership is checked before the upload is parsed, so strangers cannot make the server buffer files.
router.post('/:id/images', ...seller, validate(idParam), loadOwnedProduct, imageUpload, h(c.addImages));
router.delete(
  '/:id/images/:imageId',
  ...seller,
  validate(productImageParams),
  loadOwnedProduct,
  h(c.removeImage),
);

export default router;
