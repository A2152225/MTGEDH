import { useCallback, useEffect, useState } from 'react';
import { socket } from '../socket';
import {
  fetchAuthMe,
  loginAccount,
  logoutAccount,
  registerAccount,
  type AuthUser,
} from '../utils/authApi';
import { getStoredSessionToken } from '../utils/authSessionStorage';
import { loadLocalSavedDecks } from '../utils/localDeckStorage';

function applySocketAuthToken(token: string | null) {
  (socket.auth as any) = { ...(socket.auth as any), token: token || undefined };
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

export function useAuthSession(options?: {
  onLoginPrefillName?: (displayName: string) => void;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [moveLocalDecksOpen, setMoveLocalDecksOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetchAuthMe();
        if (!cancelled) {
          setUser(me);
          if (me) {
            applySocketAuthToken(getStoredSessionToken());
            options?.onLoginPrefillName?.(me.displayName);
          }
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const afterAuth = useCallback((next: AuthUser, offerMove: boolean) => {
    setUser(next);
    setError(null);
    applySocketAuthToken(getStoredSessionToken());
    options?.onLoginPrefillName?.(next.displayName);
    if (offerMove && loadLocalSavedDecks().length > 0) setMoveLocalDecksOpen(true);
  }, [options]);

  const login = useCallback(async (username: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await loginAccount({ username, password });
      afterAuth(data.user, true);
      return data.user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [afterAuth]);

  const register = useCallback(async (payload: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
    isAdmin?: boolean;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const data = await registerAccount(payload);
      afterAuth(data.user, true);
      return data.user;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create account';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [afterAuth]);

  const logout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await logoutAccount();
      setUser(null);
      setMoveLocalDecksOpen(false);
      applySocketAuthToken(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    user,
    busy,
    error,
    ready,
    login,
    register,
    logout,
    setError,
    moveLocalDecksOpen,
    setMoveLocalDecksOpen,
  };
}
