import * as service from '../services/product.service.js';

const wrap = (product) => ({ success: true, data: { product: product.toPublic() } });

export async function list(req, res) {
  res.json({ success: true, data: await service.listProducts(req.query) });
}
export async function getOne(req, res) {
  res.json(wrap(await service.getPublicProduct(req.params.id)));
}
export async function create(req, res) {
  res.status(201).json(wrap(await service.createProduct(req.user.id, req.body)));
}
export async function update(req, res) {
  res.json(wrap(await service.updateProduct(req.product, req.body)));
}
export async function remove(req, res) {
  await service.deleteProduct(req.product);
  res.json({ success: true, data: { message: 'Product deleted' } });
}
export async function addImages(req, res) {
  res.status(201).json(wrap(await service.addImages(req.product, req.files)));
}
export async function removeImage(req, res) {
  res.json(wrap(await service.removeImage(req.product, req.params.imageId)));
}
