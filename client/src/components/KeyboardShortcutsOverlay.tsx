/**
 * client/src/components/KeyboardShortcutsOverlay.tsx
 *
 * Press `?` (Shift+/) anywhere outside an input to toggle a help overlay
 * listing the app's keyboard shortcuts. Esc closes. Pure-additive — does not
 * register any new in-game shortcuts, only documents existing ones.
 *
 * To extend, add entries to SHORTCUT_GROUPS below.
 */

import React, { useEffect, useState } from 'react';
import { colors, radii, shadows, spacing, fontSize, z } from '../theme';

interface ShortcutEntry { keys: string; description: string; }
interface ShortcutGroup { title: string; entries: ShortcutEntry[]; }

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Table navigation',
    entries: [
      { keys: 'Space + drag', description: 'Pan the table view' },
      { keys: 'Mouse wheel', description: 'Zoom in / out' },
      { keys: 'Middle / Right click + drag', description: 'Pan the table view' },
      { keys: 'Pinch (touch)', description: 'Zoom in / out' },
    ],
  },
  {
    title: 'Game actions',
    entries: [
      { keys: 'Right click on card', description: 'Open context menu' },
      { keys: 'Long press on card (touch)', description: 'Open context menu' },
    ],
  },
  {
    title: 'UI',
    entries: [
      { keys: '?', description: 'Show / hide this shortcuts overlay' },
      { keys: 'Esc', description: 'Close the topmost overlay or modal' },
    ],
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

export const KeyboardShortcutsOverlay: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: z.shortcuts,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.lg,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surfaceRaised,
          color: colors.textPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.lg,
          boxShadow: shadows.xl,
          padding: spacing.lg,
          width: 'min(560px, 100%)',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
          <div style={{ fontSize: fontSize.xl, fontWeight: 600 }}>Keyboard shortcuts</div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close shortcuts"
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              fontSize: fontSize.xxl,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: spacing.md }}>
            <div
              style={{
                fontSize: fontSize.sm,
                fontWeight: 600,
                color: colors.accent,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: spacing.xs,
              }}
            >
              {group.title}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, auto) 1fr', gap: spacing.xs, alignItems: 'center' }}>
              {group.entries.map((e) => (
                <React.Fragment key={`${group.title}-${e.keys}`}>
                  <div>
                    <kbd
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        border: `1px solid ${colors.borderStrong}`,
                        borderRadius: radii.sm,
                        background: colors.surfaceTransparent,
                        fontSize: fontSize.xs,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        color: colors.textPrimary,
                      }}
                    >
                      {e.keys}
                    </kbd>
                  </div>
                  <div style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>{e.description}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md }}>
          Press <kbd>?</kbd> again or <kbd>Esc</kbd> to close.
        </div>
      </div>
    </div>
  );
};
