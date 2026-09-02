import type { Express, Request, Response } from 'express';
import {
  loginUser,
  logoutUser,
  registerUser,
} from '../db/users.js';
import { debug, debugError } from '../utils/debug.js';
import {
  clearLoginFailures,
  isLoginRateLimited,
  loginRateLimitRetrySeconds,
  recordLoginFailure,
} from './loginRateLimit.js';
import { getRequestAuthUser, publicAuthUser, readSessionTokenFromRequest } from './requestUser.js';
import { expireSessionCookie, serializeSessionCookie } from './sessionCookie.js';
import { isLoopbackSocket } from './loopback.js';

const USERNAME_CHARSET_RE = /^[a-zA-Z0-9_]+$/;
const USERNAME_MAX = 24;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requestIp(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type RegisterBodyOk = {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  isAdmin: boolean;
};

export function validateRegisterBody(
  body: any,
  opts?: { allowPrivileged?: boolean },
): { ok: true } & RegisterBodyOk | { ok: false; error: string } {
  const username = readString(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = readString(body?.displayName) || username;
  const emailRaw = readString(body?.email);
  const allowPrivileged = !!opts?.allowPrivileged;
  const minLen = allowPrivileged ? 2 : 3;
  const wantAdmin = body?.isAdmin === true || body?.isAdmin === 1 || body?.isAdmin === 'true';

  if (!username || username.length < minLen || username.length > USERNAME_MAX || !USERNAME_CHARSET_RE.test(username)) {
    return { ok: false, error: 'Username must be ' + minLen + '-24 characters (letters, numbers, underscore).' };
  }
  if (password.length < 8 || password.length > 200) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (!displayName || displayName.length > 40) {
    return { ok: false, error: 'Display name must be 1-40 characters.' };
  }
  let email: string | undefined;
  if (emailRaw) {
    if (!EMAIL_RE.test(emailRaw) || emailRaw.length > 120) {
      return { ok: false, error: 'Email is not valid.' };
    }
    email = emailRaw;
  }
  const isAdmin = allowPrivileged && wantAdmin;
  return { ok: true, username, password, displayName, email, isAdmin };
}

function sendAuthSuccess(res: Response, user: NonNullable<ReturnType<typeof loginUser>>['user'], token: string, status = 200) {
  res.setHeader('Set-Cookie', serializeSessionCookie(token));
  res.status(status).json({
    user: publicAuthUser(user),
    token,
  });
}

export function registerAuthHttpRoutes(app: Express): void {
  app.post('/api/auth/register', (req, res) => {
    try {
      const parsed = validateRegisterBody(req.body || {}, { allowPrivileged: isLoopbackSocket(req) });
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const result = registerUser(parsed.username, parsed.password, parsed.displayName, parsed.email, parsed.isAdmin);
      if (!result.ok) {
        const status = result.reason === 'invalid' ? 400 : 409;
        const error = result.reason === 'email_taken'
          ? 'That email is already in use.'
          : result.reason === 'invalid'
            ? 'Invalid account details.'
            : 'That username is already taken.';
        res.status(status).json({ error });
        return;
      }
      const loggedIn = loginUser(parsed.username, parsed.password);
      if (!loggedIn) {
        res.status(500).json({ error: 'Account created but login failed.' });
        return;
      }
      sendAuthSuccess(res, loggedIn.user, loggedIn.token, 201);
    } catch (err) {
      debugError(1, 'POST /api/auth/register failed:', err);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const username = readString(req.body?.username);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const ip = requestIp(req);
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required.' });
        return;
      }
      if (isLoginRateLimited(username, ip)) {
        res.status(429).json({
          error: 'Too many login attempts. Try again later.',
          retryAfterSeconds: loginRateLimitRetrySeconds(),
        });
        return;
      }
      const loggedIn = loginUser(username, password);
      if (!loggedIn) {
        recordLoginFailure(username, ip);
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }
      clearLoginFailures(username, ip);
      sendAuthSuccess(res, loggedIn.user, loggedIn.token);
    } catch (err) {
      debugError(1, 'POST /api/auth/login failed:', err);
      res.status(500).json({ error: 'Failed to log in' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    try {
      const token = readSessionTokenFromRequest(req);
      if (token) {
        logoutUser(token);
      }
      res.setHeader('Set-Cookie', expireSessionCookie());
      res.json({ success: true });
    } catch (err) {
      debugError(1, 'POST /api/auth/logout failed:', err);
      res.status(500).json({ error: 'Failed to log out' });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    try {
      const user = getRequestAuthUser(req);
      if (!user) {
        res.status(401).json({ error: 'Not logged in.' });
        return;
      }
      res.json({ user: publicAuthUser(user) });
    } catch (err) {
      debugError(1, 'GET /api/auth/me failed:', err);
      res.status(500).json({ error: 'Failed to read session' });
    }
  });

  debug(2, '[Auth] HTTP routes registered');
}
