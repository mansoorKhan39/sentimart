import multer from 'multer';
import { MAX_FILES_PER_REQUEST, MAX_IMAGE_BYTES } from '../config/constants.js';

// Memory storage: files are validated (magic bytes) and sent straight to Cloudinary.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_REQUEST },
}).array('images', MAX_FILES_PER_REQUEST);
