import * as service from '../services/category.service.js';

export async function list(_req, res) {
  res.json({ success: true, data: { categories: await service.listCategories() } });
}
export async function create(req, res) {
  res.status(201).json({ success: true, data: { category: await service.createCategory(req.body) } });
}
export async function update(req, res) {
  res.json({ success: true, data: { category: await service.updateCategory(req.params.id, req.body) } });
}
export async function remove(req, res) {
  await service.deleteCategory(req.params.id);
  res.json({ success: true, data: { message: 'Category deleted' } });
}
