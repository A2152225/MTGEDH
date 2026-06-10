/**
 * Fixed horizontal hand strip above the mobile action dock (Arena-style).
 */

import React from 'react';
import type { CardCostAdjustment, CardRef, KnownCardRef } from '../../../shared/src';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { HandGallery } from './HandGallery';
import { colors, fontSize, radii, safeArea, spacing, z } from '../theme';

export interface MobileHandStripProps {
  cards: CardRef[] | KnownCardRef[];
  handCount?: number;
  imagePref: 'small' | 'normal' | 'art_crop';
  thumbWidth: number;
  playableCards?: string[];
  costAdjustments?: Record<string, CardCostAdjustment>;
  appearanceSettings?: AppearanceSettings;
  onPlayLand?: (cardId: string) => void;
  onCast?: (cardId: string) => void;
  reasonCannotPlayLand?: (card: { type_line?: string }) => string | null;
  reasonCannotCast?: (card: { type_line?: string }) => string | null;
  onExpandHand?: () => void;
  /** Height reserved for the dock below (px, excluding safe area). */
  dockHeight?: number;
}

export const MobileHandStrip: React.FC<MobileHandStripProps> = ({
  cards,
  handCount,
  imagePref,
  thumbWidth,
  playableCards,
  costAdjustments,
  appearanceSettings,
  onPlayLand,
  onCast,
  reasonCannotPlayLand,
  reasonCannotCast,
  onExpandHand,
  dockHeight = 56,
}) => {
  const count = handCount ?? cards.length;
  if (count === 0 && cards.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `calc(${dockHeight}px + ${safeArea.bottom})`,
        zIndex: z.dock - 1,
        background: 'linear-gradient(180deg, rgba(22,18,14,0.98), rgba(14,12,10,0.99))',
        borderTop: `1px solid ${colors.borderStrong}`,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        paddingLeft: `calc(${spacing.sm}px + ${safeArea.left})`,
        paddingRight: `calc(${spacing.sm}px + ${safeArea.right})`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
          gap: spacing.sm,
        }}
      >
        <span style={{ fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: 600 }}>
          Hand ({count})
        </span>
        {onExpandHand && (
          <button
            type="button"
            onClick={onExpandHand}
            style={{
              fontSize: fontSize.xs,
              padding: '2px 8px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceTransparent,
              color: colors.textPrimary,
              cursor: 'pointer',
            }}
          >
            Expand
          </button>
        )}
      </div>
      <HandGallery
        cards={cards}
        handCount={handCount}
        imagePref={imagePref}
        thumbWidth={thumbWidth}
        layout="row"
        overlapPx={-Math.round(thumbWidth * 0.42)}
        onPlayLand={onPlayLand}
        onCast={onCast}
        reasonCannotPlayLand={reasonCannotPlayLand}
        reasonCannotCast={reasonCannotCast}
        playableCards={playableCards}
        costAdjustments={costAdjustments}
        appearanceSettings={appearanceSettings}
      />
    </div>
  );
};
