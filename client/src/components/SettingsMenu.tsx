import React, { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../utils/authApi';

const btnStyle: React.CSSProperties = {
  backgroundColor: '#4b5563',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  padding: '4px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const itemStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: '#e5e5e5',
  padding: '8px 10px',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 4,
};

export function SettingsMenu(props: {
  user: AuthUser | null;
  busy?: boolean;
  onLogout?: () => Promise<unknown> | void;
  onOpenAppearance: () => void;
}) {
  const { user, busy, onLogout, onOpenAppearance } = props;
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'menu' | 'profile'>('menu');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSection('menu');
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setSection('menu');
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setSection('menu');
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setSection('menu');
        }}
        style={btnStyle}
        title="Settings"
      >
        Settings
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            minWidth: 240,
            zIndex: 50,
            background: 'rgba(24, 24, 32, 0.98)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            padding: 8,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {section === 'profile' && user ? (
            <div>
              <button type="button" onClick={() => setSection('menu')} style={{ ...itemStyle, color: '#9ca3af' }}>
                Back
              </button>
              <div style={{ padding: '6px 10px 10px' }}>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Profile</div>
                <div style={{ fontSize: 13, color: '#c4b5fd', fontWeight: 600 }}>{user.displayName}</div>
                {user.email ? (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{user.email}</div>
                ) : (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>No email on file</div>
                )}
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Role</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: user.isAdmin ? '#fbbf24' : '#d1d5db',
                      background: user.isAdmin ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.08)',
                      border: '1px solid ' + (user.isAdmin ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'),
                      borderRadius: 999,
                      padding: '1px 8px',
                    }}
                  >
                    {user.isAdmin ? 'Admin' : 'User'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void onLogout?.();
                  close();
                }}
                style={{ ...itemStyle, color: '#f87171' }}
              >
                Logout
              </button>
            </div>
          ) : (
            <div>
              {user && (
                <button type="button" onClick={() => setSection('profile')} style={itemStyle}>
                  Profile
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenAppearance();
                }}
                style={itemStyle}
              >
                Appearance
              </button>
              {user && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void onLogout?.();
                    close();
                  }}
                  style={{ ...itemStyle, color: '#f87171' }}
                >
                  Logout
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SettingsMenu;
