import * as service from '../services/review.service.js';

const one = (review) => ({ success: true, data: { review: service.reviewView(review) } });

export async function list(req, res) {
  res.json({ success: true, data: await service.listProductReviews(req.params.id, req.query) });
}
export async function eligibility(req, res) {
  res.json({ success: true, data: await service.getEligibility(req.user.id, req.params.id) });
}
export async function create(req, res) {
  const review = await service.createReview(req.user.id, req.params.id, req.body);
  await review.populate('authorId', 'name');
  res.status(201).json(one(review));
}
export async function update(req, res) {
  const review = await service.updateReview(req.user.id, req.params.id, req.body);
  await review.populate('authorId', 'name');
  res.json(one(review));
}
export async function remove(req, res) {
  await service.deleteReview(req.user.id, req.params.id);
  res.json({ success: true, data: { message: 'Review deleted' } });
}
export async function reply(req, res) {
  res.json(one(await service.replyToReview(req.user.id, req.params.id, req.body.text)));
}
export async function retryPending(_req, res) {
  res.json({ success: true, data: await service.retryPending() });
}
