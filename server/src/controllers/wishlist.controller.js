import * as service from '../services/wishlist.service.js';

export async function list(req, res) {
  res.json({ success: true, data: { products: await service.listWishlist(req.user.id) } });
}
export async function add(req, res) {
  res.status(201).json({
    success: true,
    data: { wishlist: await service.addToWishlist(req.user.id, req.params.productId) },
  });
}
export async function remove(req, res) {
  res.json({
    success: true,
    data: { wishlist: await service.removeFromWishlist(req.user.id, req.params.productId) },
  });
}
