import React, { useEffect, useState } from 'react';
import type { AuthUser } from '../utils/authApi';

const USERNAME_RE = /^[a-zA-Z0-9_]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthSessionPanel(props: {
  user: AuthUser | null;
  busy?: boolean;
  error?: string | null;
  nameInput: string;
  onNameInput: (name: string) => void;
  onLogin: (username: string, password: string) => Promise<unknown>;
  onRegister: (payload: { username: string; password: string; displayName: string; email?: string; isAdmin?: boolean }) => Promise<unknown>;
  onLogout: () => Promise<unknown> | void;
}) {
  const { user, busy, error, nameInput, onNameInput, onLogin, onRegister } = props;
  const [mode, setMode] = useState<'closed' | 'login' | 'register'>('closed');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const localCreatorHost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '::1'
    || window.location.hostname === '[::1]'
  );

  const inputStyle: React.CSSProperties = {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(0,0,0,0.3)',
    color: '#e5e5e5',
    fontSize: 12,
  };
  const btnStyle: React.CSSProperties = {
    backgroundColor: '#4b5563',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 12,
    cursor: busy ? 'wait' : 'pointer',
  };

  const shownError = localError || error || null;

  useEffect(() => {
    if (!user?.displayName) return;
    if (nameInput !== user.displayName) onNameInput(user.displayName);
  }, [user, nameInput, onNameInput]);

  function validate(): string | null {
    const u = username.trim();
    if (!USERNAME_RE.test(u)) {
      return 'Username must be 2-24 characters (letters, numbers, underscore).';
    }
    if (password.length < 8 || password.length > 200) {
      return 'Password must be at least 8 characters.';
    }
    if (mode === 'register') {
      const dn = displayName.trim() || u;
      if (!dn || dn.length > 40) {
        return 'Display name must be 1-40 characters.';
      }
      const em = email.trim();
      if (em && (!EMAIL_RE.test(em) || em.length > 120)) {
        return 'Email is not valid.';
      }
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setLocalError(null);
    const invalid = validate();
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    const u = username.trim();
    const em = email.trim();
    let run: Promise<unknown>;
    try {
      run = Promise.resolve(
        mode === 'login'
          ? onLogin(u, password)
          : onRegister({
              username: u,
              password,
              displayName: displayName.trim() || u,
              email: em || undefined,
              isAdmin: localCreatorHost ? isAdmin : undefined,
            }),
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed');
      return;
    }
    void run.then(() => {
      setPassword('');
      setMode('closed');
    }).catch((err) => {
      setLocalError(err instanceof Error ? err.message : 'Failed');
    });
  }

  if (user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#c4b5fd', whiteSpace: 'nowrap' }}>
          Playing as {user.displayName}
        </span>
        {shownError && <span role="alert" style={{ fontSize: 11, color: '#f87171' }}>{shownError}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>Playing as</span>
      <input
        value={nameInput}
        onChange={(e) => onNameInput(e.target.value)}
        placeholder="Your name"
        style={inputStyle}
      />
      {mode === 'closed' && (
        <>
          <button type="button" onClick={() => { setMode('login'); setLocalError(null); }} style={btnStyle}>Log in</button>
          <button type="button" onClick={() => { setMode('register'); setLocalError(null); setIsAdmin(false); }} style={{ ...btnStyle, backgroundColor: '#6366f1' }}>
            Create account
          </button>
        </>
      )}
      {mode !== 'closed' && (
        <form
          onSubmit={handleSubmit}
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" style={inputStyle} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} style={inputStyle} />
          {mode === 'register' && (
            <>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" style={inputStyle} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" style={inputStyle} />
              {localCreatorHost && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#e5e5e5' }}>
                  <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
                  Admin
                </label>
              )}
            </>
          )}
          <button type="submit" disabled={busy} style={{ ...btnStyle, backgroundColor: '#10b981' }}>
            {busy
              ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
              : (mode === 'login' ? 'Sign in' : 'Create my account')}
          </button>
          <button type="button" onClick={() => { setMode('closed'); setLocalError(null); }} style={btnStyle}>Cancel</button>
        </form>
      )}
      {shownError && <span role="alert" style={{ fontSize: 11, color: '#f87171' }}>{shownError}</span>}
    </div>
  );
}
