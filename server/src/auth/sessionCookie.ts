/**
 * Session cookie helpers for username/password auth.
 * Cookie is httpOnly; clients may also send the raw token via Authorization.
 */
export const SESSION_COOKIE_NAME = 'mtgedh_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function serializeSessionCookie(token: string): string {
  const safe = encodeURIComponent(token);
  return `${SESSION_COOKIE_NAME}=${safe}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function expireSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readTokenFromCookieHeader(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const raw = trimmed.slice(eq + 1).trim();
    try {
      const decoded = decodeURIComponent(raw);
      return decoded || null;
    } catch {
      return raw || null;
    }
  }
  return null;
}

export function readTokenFromAuthorization(header: string | undefined | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const token = match[1].trim();
  return token || null;
}
