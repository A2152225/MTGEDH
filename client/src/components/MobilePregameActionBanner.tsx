/**
 * In-flow mobile banner for Keep Hand / Mulligan after deck select.
 * Sits in the same slot as the Import Deck CTA so the next action is obvious.
 */

import React from 'react';
import { colors, fontSize, radii, spacing } from '../theme';
import { MobileMulliganActions } from './MobileMulliganActions';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';

export interface MobilePregameActionBannerProps {
  mode: Exclude<MobilePrimaryActionMode, 'play'>;
  canKeepHand?: boolean;
  canMulligan?: boolean;
  canUnkeepHand?: boolean;
  mulligansTaken?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onUnkeepHand?: () => void;
  onRandomizeStart?: () => void;
}

export const MobilePregameActionBanner: React.FC<MobilePregameActionBannerProps> = ({
  mode,
  canKeepHand,
  canMulligan,
  canUnkeepHand,
  mulligansTaken,
  onKeepHand,
  onMulligan,
  onUnkeepHand,
  onRandomizeStart,
}) => {
  const waiting = mode === 'unkeep';
  return (
    <div
      role="region"
      aria-label={waiting ? 'Hand kept' : 'Keep or mulligan your opening hand'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.sm,
        padding: `${spacing.md}px ${spacing.md}px`,
        borderRadius: radii.xl,
        border: waiting
          ? '1px solid rgba(16, 185, 129, 0.45)'
          : '1px solid rgba(16, 185, 129, 0.65)',
        background: waiting
          ? 'rgba(6, 78, 59, 0.35)'
          : 'linear-gradient(90deg, rgba(6, 78, 59, 0.45), rgba(20, 83, 45, 0.3))',
        boxShadow: '0 4px 16px rgba(16, 185, 129, 0.18)',
      }}
    >
      <div style={{ fontSize: fontSize.md, color: '#d1fae5', lineHeight: 1.4 }}>
        {waiting ? (
          <strong>Hand kept.</strong>
        ) : (
          <strong>Review your opening hand, then keep or mulligan.</strong>
        )}
        {waiting
          ? ' You can unkeep until every player is ready.'
          : ' Keep Hand is also on the bottom bar and in the Hand sheet.'}
      </div>
      <MobileMulliganActions
        mode={mode}
        canKeepHand={canKeepHand}
        canMulligan={canMulligan}
        canUnkeepHand={canUnkeepHand}
        mulligansTaken={mulligansTaken}
        onKeepHand={onKeepHand}
        onMulligan={onMulligan}
        onUnkeepHand={onUnkeepHand}
        onRandomizeStart={onRandomizeStart}
        showRandomStart
      />
    </div>
  );
};
