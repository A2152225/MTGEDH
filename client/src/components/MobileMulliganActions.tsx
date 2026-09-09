/**
 * Shared Keep Hand / Mulligan / Unkeep controls for mobile play chrome.
 * Used by the action dock, pregame banner, and hand/more sheets.
 */

import React from 'react';
import { colors, fontSize, radii, spacing, touch } from '../theme';

export interface MobileMulliganActionsProps {
  mode: 'mulligan' | 'unkeep';
  canKeepHand?: boolean;
  canMulligan?: boolean;
  canUnkeepHand?: boolean;
  mulligansTaken?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onUnkeepHand?: () => void;
  onRandomizeStart?: () => void;
  showRandomStart?: boolean;
  /** Stretch buttons for the bottom dock; banner/sheet stay compact-wrap. */
  fill?: boolean;
}

const actionButtonStyle = (opts: {
  background: string;
  disabled?: boolean;
  fill?: boolean;
}): React.CSSProperties => ({
  flex: opts.fill ? 1 : '1 1 auto',
  minHeight: touch.minHitTarget,
  minWidth: opts.fill ? 0 : 96,
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderRadius: radii.lg,
  border: 'none',
  background: opts.background,
  color: '#fff',
  cursor: opts.disabled ? 'not-allowed' : 'pointer',
  opacity: opts.disabled ? 0.5 : 1,
  fontSize: fontSize.md,
  fontWeight: 700,
  whiteSpace: 'nowrap',
});

export const MobileMulliganActions: React.FC<MobileMulliganActionsProps> = ({
  mode,
  canKeepHand,
  canMulligan,
  canUnkeepHand,
  mulligansTaken = 0,
  onKeepHand,
  onMulligan,
  onUnkeepHand,
  onRandomizeStart,
  showRandomStart,
  fill,
}) => {
  return (
    <div
      role="group"
      aria-label={mode === 'unkeep' ? 'Hand kept actions' : 'Opening hand actions'}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: spacing.sm,
        flexWrap: fill ? 'nowrap' : 'wrap',
        flex: fill ? '2 1 0' : undefined,
        minWidth: 0,
      }}
    >
      {mode === 'mulligan' ? (
        <>
          <button
            type="button"
            onClick={onKeepHand}
            disabled={!canKeepHand}
            aria-label="Keep Hand"
            style={actionButtonStyle({
              background: canKeepHand ? colors.success : '#4b5563',
              disabled: !canKeepHand,
              fill,
            })}
          >
            Keep Hand
          </button>
          <button
            type="button"
            onClick={onMulligan}
            disabled={!canMulligan}
            aria-label="Mulligan"
            style={actionButtonStyle({
              background: canMulligan ? colors.warning : '#4b5563',
              disabled: !canMulligan,
              fill,
            })}
          >
            Mulligan{mulligansTaken > 0 ? ` (${mulligansTaken})` : ''}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onUnkeepHand}
          disabled={!canUnkeepHand}
          aria-label="Unkeep Hand"
          style={actionButtonStyle({
            background: canUnkeepHand ? '#059669' : '#4b5563',
            disabled: !canUnkeepHand,
            fill,
          })}
        >
          Unkeep
        </button>
      )}
      {showRandomStart && onRandomizeStart && (
        <button
          type="button"
          onClick={onRandomizeStart}
          aria-label="Random Start"
          style={actionButtonStyle({
            background: '#8b5cf6',
            fill,
          })}
        >
          Random Start
        </button>
      )}
    </div>
  );
};
