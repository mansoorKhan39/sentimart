import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';

export async function getById(id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

export async function updateProfile(id, changes) {
  const user = await User.findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}
