import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const API = 'https://api.cloudinary.com/v1_1';
const FOLDER = 'sentimart/products';

export const isConfigured = () =>
  Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

// Cloudinary signature: sha1 of "k1=v1&k2=v2" (keys sorted) followed by the API secret.
export function signParams(params, secret = env.CLOUDINARY_API_SECRET) {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

export async function uploadImage(buffer, mimetype) {
  if (!isConfigured()) {
    throw new ApiError(503, 'UPLOAD_NOT_CONFIGURED', 'Image upload is not configured');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), 'upload');
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', FOLDER);
  form.append('signature', signParams({ folder: FOLDER, timestamp }));

  let res;
  try {
    res = await fetch(`${API}/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    logger.warn('cloudinary upload failed', { error: err.message });
    throw new ApiError(502, 'UPLOAD_FAILED', 'Image upload failed, please try again');
  }
  if (!res.ok) {
    logger.warn('cloudinary upload rejected', { status: res.status });
    throw new ApiError(502, 'UPLOAD_FAILED', 'Image upload failed, please try again');
  }
  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id };
}

// Best effort: never throws, so a Cloudinary hiccup cannot break deleting a product.
export async function destroyImage(publicId) {
  if (!publicId || publicId.startsWith('seed:') || !isConfigured()) return;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: env.CLOUDINARY_API_KEY,
      signature: signParams({ public_id: publicId, timestamp }),
    });
    await fetch(`${API}/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn('cloudinary destroy failed', { error: err.message });
  }
}
