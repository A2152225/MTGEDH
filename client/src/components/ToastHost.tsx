/**
 * client/src/components/ToastHost.tsx
 *
 * Lightweight, dependency-free toast/snackbar system. Renders a fixed stack
 * of dismissible messages in the bottom-right (or bottom-center on mobile).
 *
 * Usage:
 *   1. Mount <ToastHost /> once near the app root.
 *   2. Call `toast('saved')`, `toast.error('...')`, `toast.success('...')`,
 *      `toast.warn('...')`, or `toast({ message, kind, durationMs })` from
 *      anywhere — no React context required.
 *
 * Designed as a passive UX layer to replace small interrupt-style modals
 * (e.g. "you can't do that"). Existing modals continue to work unchanged.
 */

import React, { useEffect, useState } from 'react';
import { colors, radii, shadows, spacing, fontSize, z, safeArea } from '../theme';

type ToastKind = 'info' | 'success' | 'warn' | 'error';
interface ToastEntry {
  id: number;
  message: string;
  kind: ToastKind;
  durationMs: number;
  createdAt: number;
}

let nextId = 1;
const subscribers = new Set<(toasts: ToastEntry[]) => void>();
let active: ToastEntry[] = [];

function notify() {
  for (const sub of subscribers) sub(active.slice());
}

function pushToast(entry: Omit<ToastEntry, 'id' | 'createdAt'>): number {
  const t: ToastEntry = { id: nextId++, createdAt: Date.now(), ...entry };
  active = [...active, t];
  // Auto-cap so a runaway loop can't swamp the UI.
  if (active.length > 6) {
    active = active.slice(active.length - 6);
  }
  notify();
  if (t.durationMs > 0) {
    window.setTimeout(() => dismissToast(t.id), t.durationMs);
  }
  return t.id;
}

export function dismissToast(id: number) {
  active = active.filter((t) => t.id !== id);
  notify();
}

export interface ToastOptions {
  message: string;
  kind?: ToastKind;
  durationMs?: number;
}

interface ToastFn {
  (message: string | ToastOptions): number;
  info: (message: string, durationMs?: number) => number;
  success: (message: string, durationMs?: number) => number;
  warn: (message: string, durationMs?: number) => number;
  error: (message: string, durationMs?: number) => number;
  dismiss: (id: number) => void;
}

export const toast: ToastFn = ((arg: string | ToastOptions) => {
  if (typeof arg === 'string') {
    return pushToast({ message: arg, kind: 'info', durationMs: 3500 });
  }
  return pushToast({
    message: arg.message,
    kind: arg.kind || 'info',
    durationMs: typeof arg.durationMs === 'number' ? arg.durationMs : 3500,
  });
}) as ToastFn;
toast.info = (m: string, d = 3500) => pushToast({ message: m, kind: 'info', durationMs: d });
toast.success = (m: string, d = 3000) => pushToast({ message: m, kind: 'success', durationMs: d });
toast.warn = (m: string, d = 4500) => pushToast({ message: m, kind: 'warn', durationMs: d });
toast.error = (m: string, d = 6000) => pushToast({ message: m, kind: 'error', durationMs: d });
toast.dismiss = dismissToast;

const KIND_ACCENT: Record<ToastKind, string> = {
  info: colors.info,
  success: colors.success,
  warn: colors.warning,
  error: colors.danger,
};

export const ToastHost: React.FC<{ position?: 'bottom-right' | 'bottom-center' | 'top-right' }> = ({
  position = 'bottom-right',
}) => {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  useEffect(() => {
    subscribers.add(setToasts);
    setToasts(active.slice());
    return () => {
      subscribers.delete(setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  const isBottom = position.startsWith('bottom');
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: z.toast,
    display: 'flex',
    flexDirection: isBottom ? 'column-reverse' : 'column',
    gap: spacing.sm,
    padding: spacing.md,
    pointerEvents: 'none',
    maxWidth: 360,
  };
  if (position === 'bottom-right') {
    containerStyle.right = 0;
    containerStyle.bottom = 0;
    containerStyle.paddingRight = `calc(${spacing.md}px + ${safeArea.right})`;
    containerStyle.paddingBottom = `calc(${spacing.md}px + ${safeArea.bottom})`;
  } else if (position === 'bottom-center') {
    containerStyle.left = '50%';
    containerStyle.transform = 'translateX(-50%)';
    containerStyle.bottom = 0;
    containerStyle.paddingBottom = `calc(${spacing.md}px + ${safeArea.bottom})`;
  } else {
    containerStyle.right = 0;
    containerStyle.top = 0;
    containerStyle.paddingTop = `calc(${spacing.md}px + ${safeArea.top})`;
    containerStyle.paddingRight = `calc(${spacing.md}px + ${safeArea.right})`;
  }

  return (
    <div style={containerStyle} aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          style={{
            pointerEvents: 'auto',
            background: colors.surfaceRaised,
            color: colors.textPrimary,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${KIND_ACCENT[t.kind]}`,
            borderRadius: radii.md,
            boxShadow: shadows.md,
            padding: `${spacing.sm}px ${spacing.md}px`,
            fontSize: fontSize.sm,
            lineHeight: 1.35,
            display: 'flex',
            alignItems: 'flex-start',
            gap: spacing.sm,
            minWidth: 220,
          }}
        >
          <div style={{ flex: 1, wordBreak: 'break-word' }}>{t.message}</div>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              fontSize: fontSize.lg,
              lineHeight: 1,
              padding: 0,
              marginLeft: spacing.xs,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
