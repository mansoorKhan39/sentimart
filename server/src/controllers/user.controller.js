import * as userService from '../services/user.service.js';

export async function getMe(req, res) {
  const user = await userService.getById(req.user.id);
  res.json({ success: true, data: { user: user.toPublic() } });
}

export async function updateMe(req, res) {
  const user = await userService.updateProfile(req.user.id, req.body);
  res.json({ success: true, data: { user: user.toPublic() } });
}
