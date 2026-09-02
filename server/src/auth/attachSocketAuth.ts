import type { Socket } from 'socket.io';
import { validateSession } from '../db/users.js';
import { userIsAdmin } from './requestUser.js';
import { readTokenFromAuthorization, readTokenFromCookieHeader } from './sessionCookie.js';
import { debug } from '../utils/debug.js';

function readHandshakeToken(socket: Socket): string | null {
  const auth = (socket.handshake as any)?.auth;
  const fromAuth = typeof auth?.token === 'string' ? auth.token.trim() : '';
  if (fromAuth) return fromAuth;
  const headers = socket.handshake?.headers || {};
  const fromHeader = readTokenFromAuthorization(
    (headers.authorization as string | undefined) || (headers.Authorization as string | undefined),
  );
  if (fromHeader) return fromHeader;
  return readTokenFromCookieHeader((headers.cookie as string | undefined) || null);
}

export function attachSocketAuth(socket: Socket): void {
  const token = readHandshakeToken(socket);
  if (!token) return;
  const user = validateSession(token);
  if (!user) return;
  (socket.data as any).accountUserId = user.id;
  (socket.data as any).accountUsername = user.username;
  (socket.data as any).accountDisplayName = user.display_name;
  (socket.data as any).accountIsAdmin = userIsAdmin(user);
  debug(2, '[Auth] socket attached to account', { socketId: socket.id, userId: user.id });
}

export function getSocketAccountUserId(socket: { data?: any }): string | null {
  const id = socket.data?.accountUserId;
  return typeof id === 'string' && id.trim() ? id : null;
}

export function getSocketAccountIsAdmin(socket: { data?: any }): boolean {
  return socket.data?.accountIsAdmin === true;
}
