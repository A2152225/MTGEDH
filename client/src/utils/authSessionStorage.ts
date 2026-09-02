const TOKEN_KEY = 'mtgedh:sessionToken';

export function getStoredSessionToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export function storeSessionToken(token: string | null): void {
  try {
    if (token && token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getStoredSessionToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
