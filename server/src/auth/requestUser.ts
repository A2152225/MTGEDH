import type { Request } from 'express';
import { validateSession, type User } from '../db/users.js';
import { readTokenFromAuthorization, readTokenFromCookieHeader } from './sessionCookie.js';

export type AuthUser = Omit<User, 'password_hash'>;

export function readSessionTokenFromRequest(req: Request): string | null {
  const fromAuth = readTokenFromAuthorization(req.header('authorization') || req.header('Authorization'));
  if (fromAuth) return fromAuth;
  const fromCookie = readTokenFromCookieHeader(req.header('cookie') || req.header('Cookie'));
  if (fromCookie) return fromCookie;
  const fromCustom = req.header('x-session-token');
  if (typeof fromCustom === 'string' && fromCustom.trim()) return fromCustom.trim();
  return null;
}

export function getRequestAuthUser(req: Request): AuthUser | null {
  const token = readSessionTokenFromRequest(req);
  if (!token) return null;
  return validateSession(token);
}

export function userIsAdmin(user: { is_admin?: number | boolean | null } | null | undefined): boolean {
  if (!user) return false;
  return user.is_admin === true || Number(user.is_admin) === 1;
}

export function publicAuthUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email || null,
    isAdmin: userIsAdmin(user),
  };
}
