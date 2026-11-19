import { emit } from '../events/emitter.js';
import '../events/listeners.js';
import * as service from '../services/admin.service.js';
import { recordAudit } from '../services/audit.service.js';
import { platformReport } from '../services/report.service.js';

const ok = (res, data) => res.json({ success: true, data });

export async function listUsers(req, res) {
  ok(res, await service.listUsers(req.query));
}
export async function setUserStatus(req, res) {
  const { user, changed } = await service.setUserStatus(req.params.id, req.body.status);
  if (changed) {
    await recordAudit(req, 'user.status', {
      targetType: 'user',
      targetId: user._id,
      meta: { status: req.body.status },
    });
  }
  ok(res, { user: { id: String(user._id), status: user.status, role: user.role } });
}

export async function listSellers(req, res) {
  ok(res, await service.listSellers(req.query));
}
export async function setSellerApproval(req, res) {
  const { approvalStatus, reason } = req.body;
  const { seller, changed } = await service.setSellerApproval(req.params.id, approvalStatus);
  if (changed) {
    await recordAudit(req, 'seller.approval', {
      targetType: 'user',
      targetId: seller._id,
      meta: { approvalStatus, reason },
    });
    await emit('seller.approval', { seller, status: approvalStatus, reason });
  }
  ok(res, { seller: { id: String(seller._id), approvalStatus: seller.seller?.approvalStatus } });
}

export async function listProducts(req, res) {
  ok(res, await service.listAdminProducts(req.query));
}
export async function setProductStatus(req, res) {
  const product = await service.setProductStatus(req.params.id, req.body.status);
  await recordAudit(req, 'product.status', {
    targetType: 'product',
    targetId: req.params.id,
    meta: { status: req.body.status },
  });
  ok(res, { product });
}
export async function deleteProduct(req, res) {
  const product = await service.deleteAnyProduct(req.params.id);
  await recordAudit(req, 'product.delete', {
    targetType: 'product',
    targetId: product._id,
    meta: { title: product.title },
  });
  ok(res, { message: 'Product deleted' });
}

export async function flagged(req, res) {
  ok(res, await service.listFlaggedReviews(req.query));
}
export async function moderate(req, res) {
  const review = await service.moderateReview(req.params.id, req.body.action);
  await recordAudit(req, 'review.moderate', {
    targetType: 'review',
    targetId: review._id,
    meta: { action: req.body.action },
  });
  ok(res, { review: { id: String(review._id), status: review.status } });
}

export async function report(req, res) {
  ok(res, await platformReport(req.query));
}
export async function auditLog(req, res) {
  ok(res, await service.listAuditLog(req.query));
}
