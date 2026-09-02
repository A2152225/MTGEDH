import { authHeaders, storeSessionToken } from './authSessionStorage';

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  isAdmin?: boolean;
};

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof (data as { error?: string }).error === 'string'
      ? (data as { error: string }).error
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function registerAccount(payload: {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  isAdmin?: boolean;
}): Promise<{ user: AuthUser; token: string }> {
  const data = await readJson<{ user: AuthUser; token: string }>(await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  storeSessionToken(data.token);
  return data;
}

export async function loginAccount(payload: {
  username: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  const data = await readJson<{ user: AuthUser; token: string }>(await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  storeSessionToken(data.token);
  return data;
}

export async function logoutAccount(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
  } finally {
    storeSessionToken(null);
  }
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 401) return null;
  const data = await readJson<{ user: AuthUser }>(res);
  return data.user;
}
