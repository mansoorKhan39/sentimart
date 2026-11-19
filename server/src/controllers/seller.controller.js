import * as analytics from '../services/analytics.service.js';
import * as service from '../services/seller.service.js';

const ok = (res, data) => res.json({ success: true, data });

export async function inventory(req, res) {
  ok(res, await service.listInventory(req.user.id, req.query));
}
export async function reviews(req, res) {
  ok(res, await service.listSellerReviews(req.user.id, req.query));
}
export async function overview(req, res) {
  ok(res, await analytics.overview(req.user.id));
}
export async function sales(req, res) {
  ok(res, await analytics.salesAnalytics(req.user.id, req.query));
}
export async function sentiment(req, res) {
  ok(res, await analytics.sentimentAnalytics(req.user.id, req.query));
}
export async function complaints(req, res) {
  ok(res, await analytics.complaintsAnalytics(req.user.id, req.query));
}
export async function exportCsv(req, res) {
  const { filename, csv } = await analytics.exportCsv(req.user.id, req.query);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.send(csv);
}
