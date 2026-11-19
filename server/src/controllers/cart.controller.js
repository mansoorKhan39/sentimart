import * as service from '../services/cart.service.js';

const send = (res, cart) => res.json({ success: true, data: { cart } });

export async function get(req, res) {
  send(res, await service.getCartView(req.user.id));
}
export async function setQuantity(req, res) {
  send(res, await service.setItemQuantity(req.user.id, req.params.productId, req.body.qty));
}
export async function removeItem(req, res) {
  send(res, await service.removeItem(req.user.id, req.params.productId));
}
export async function clear(req, res) {
  send(res, await service.clearCart(req.user.id));
}
