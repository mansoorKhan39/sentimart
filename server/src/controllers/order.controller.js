import * as service from '../services/order.service.js';

export async function create(req, res) {
  res
    .status(201)
    .json({ success: true, data: { order: await service.checkout(req.user.id, req.body) } });
}
export async function list(req, res) {
  res.json({ success: true, data: await service.listOrders(req.user.id, req.query) });
}
export async function getOne(req, res) {
  res.json({ success: true, data: { order: await service.getOrder(req.user.id, req.params.id) } });
}
export async function cancel(req, res) {
  res.json({
    success: true,
    data: { subOrder: await service.cancelSubOrder(req.user.id, req.params.id) },
  });
}
export async function sellerList(req, res) {
  res.json({ success: true, data: await service.listSellerSubOrders(req.user.id, req.query) });
}
export async function sellerStatus(req, res) {
  res.json({
    success: true,
    data: {
      subOrder: await service.updateSellerStatus(req.user.id, req.params.id, req.body.status),
    },
  });
}
