import { env } from '../config/env.js';
import * as authService from '../services/auth.service.js';

const COOKIE = 'refreshToken';
const baseCookie = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
});
const setRefreshCookie = (res, token) =>
  res.cookie(COOKIE, token, { ...baseCookie(), maxAge: env.REFRESH_TTL_DAYS * 86_400_000 });

export async function register(req, res) {
  const user = await authService.register(req.body);
  res.status(201).json({ success: true, data: { user: user.toPublic() } });
}

export async function login(req, res) {
  const session = await authService.login(req.body);
  setRefreshCookie(res, session.refreshToken);
  res.json({ success: true, data: { accessToken: session.accessToken, user: session.user } });
}

export async function refresh(req, res) {
  const session = await authService.refresh(req.cookies?.[COOKIE]);
  setRefreshCookie(res, session.refreshToken);
  res.json({ success: true, data: { accessToken: session.accessToken, user: session.user } });
}

export async function logout(req, res) {
  await authService.logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, baseCookie());
  res.json({ success: true, data: { message: 'Logged out' } });
}

export async function forgotPassword(req, res) {
  await authService.forgotPassword(req.body.email);
  res.json({ success: true, data: { message: 'If that email exists, a reset link has been sent.' } });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.params.token, req.body.password);
  res.json({ success: true, data: { message: 'Password updated. Please log in.' } });
}
