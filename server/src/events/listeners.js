import { on } from './emitter.js';
import { User } from '../models/user.model.js';
import {
  negativeReviewEmail,
  newSubOrderEmail,
  orderConfirmationEmail,
  sellerApprovalEmail,
  sendEmail,
  statusChangedEmail,
} from '../services/email.service.js';

// Registered once when this file is imported (order.service imports it).
on('order.created', async ({ order, subOrders }) => {
  const ids = [order.customerId, ...subOrders.map((s) => s.sellerId)];
  const users = await User.find({ _id: { $in: ids } }).select(
    'name email role seller.businessName',
  );
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const customer = byId.get(String(order.customerId));
  const jobs = [];
  if (customer) jobs.push(sendEmail(orderConfirmationEmail(customer, order, subOrders)));
  for (const sub of subOrders) {
    const seller = byId.get(String(sub.sellerId));
    if (seller) jobs.push(sendEmail(newSubOrderEmail(seller, sub, order)));
  }
  await Promise.allSettled(jobs);
});

on('sub-order.status_changed', async ({ subOrder }) => {
  const customer = await User.findById(subOrder.customerId).select('name email');
  if (customer) await sendEmail(statusChangedEmail(customer, subOrder));
});

// FR-43: tell the seller about a new negative review (flagged reviews are held back for the admin).
on('review.created', async ({ review, product }) => {
  if (review.status !== 'published' || review.sentiment?.label !== 'negative') return;
  const seller = await User.findById(product.sellerId).select('name email seller.businessName');
  if (seller) await sendEmail(negativeReviewEmail(seller, product, review));
});

// FR-42: the seller is told when an admin approves or rejects the application.
on('seller.approval', async ({ seller, status, reason }) => {
  await sendEmail(sellerApprovalEmail(seller, status, reason));
});
