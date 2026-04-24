/**
 * client/src/components/Sheet.tsx
 *
 * Adaptive modal container: renders as a centered modal on desktop and as a
 * bottom sheet on touch devices. Pure-additive — existing modals continue to
 * work unchanged. New / refactored modals can opt-in by wrapping their body
 * in <Sheet open=...>.
 */

import React, { useEffect } from 'react';
import { useIsTouch } from '../hooks/useIsTouch';
import { colors, radii, shadows, spacing, fontSize, z, safeArea } from '../theme';

export interface SheetProps {
  open: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  /** Width on desktop (px). Ignored on touch (which goes full-width). */
  desktopWidth?: number;
  /** When true, clicking the backdrop closes the sheet. */
  dismissOnBackdrop?: boolean;
  /** When true, presses Esc to close. */
  dismissOnEscape?: boolean;
  /** When true, hides the default header/title bar (caller renders its own). */
  hideHeader?: boolean;
  children?: React.ReactNode;
}

export const Sheet: React.FC<SheetProps> = ({
  open,
  onClose,
  title,
  desktopWidth = 480,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  hideHeader,
  children,
}) => {
  const isTouch = useIsTouch();

  useEffect(() => {
    if (!open || !dismissOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissOnEscape, onClose]);

  if (!open) return null;

  const onBackdrop = () => {
    if (dismissOnBackdrop) onClose?.();
  };

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: z.modalBackdrop,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: isTouch ? 'flex-end' : 'center',
    justifyContent: 'center',
    padding: isTouch ? 0 : spacing.lg,
  };

  const sheetStyle: React.CSSProperties = isTouch
    ? {
        width: '100%',
        maxHeight: '90vh',
        background: colors.surfaceRaised,
        color: colors.textPrimary,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        boxShadow: shadows.xl,
        display: 'flex',
        flexDirection: 'column',
        paddingBottom: `calc(${spacing.md}px + ${safeArea.bottom})`,
        zIndex: z.modal,
      }
    : {
        width: 'min(100%, ' + desktopWidth + 'px)',
        maxHeight: '85vh',
        background: colors.surfaceRaised,
        color: colors.textPrimary,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        boxShadow: shadows.xl,
        display: 'flex',
        flexDirection: 'column',
        zIndex: z.modal,
      };

  return (
    <div role="presentation" style={backdropStyle} onClick={onBackdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
        style={sheetStyle}
      >
        {isTouch && (
          <div
            aria-hidden="true"
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: radii.pill,
              background: colors.borderStrong,
              margin: `${spacing.sm}px 0 ${spacing.xs}px`,
            }}
          />
        )}
        {!hideHeader && (title || onClose) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderBottom: `1px solid ${colors.borderSubtle}`,
            }}
          >
            <div style={{ fontSize: fontSize.lg, fontWeight: 600 }}>{title}</div>
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: colors.textSecondary,
                  cursor: 'pointer',
                  fontSize: fontSize.xxl,
                  lineHeight: 1,
                  padding: spacing.xs,
                }}
              >
                ×
              </button>
            )}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: spacing.md }}>
          {children}
        </div>
      </div>
    </div>
  );
};
