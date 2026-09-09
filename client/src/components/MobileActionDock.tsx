/**
 * client/src/components/MobileActionDock.tsx
 *
 * Compact, always-visible action bar shown only on mobile (narrow + touch
 * device) during an active table. Surfaces the most common in-game actions
 * — Pass Priority, Hand, Stack, Mana — so the player doesn't have to
 * hunt through the desktop utility rail on a small screen.
 *
 * During opening-hand / mulligan, Keep Hand and Mulligan replace Pass so
 * those actions stay on the safe-area dock instead of the hidden compact
 * status-bar extraActions row.
 *
 * Pure-additive: rendered alongside the existing UI. Desktop is unaffected
 * because the host App must gate the render with mobile chrome.
 *
 * The dock takes only callbacks and a counts/state object — it does not
 * reach into the App's state or sockets directly.
 */

import React from 'react';
import { colors, spacing, fontSize, radii, shadows, z, safeArea } from '../theme';
import { MobileMulliganActions } from './MobileMulliganActions';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';

export interface MobileActionDockProps {
  onPassPriority?: () => void;
  onOpenHand?: () => void;
  onOpenStack?: () => void;
  onOpenMana?: () => void;
  onOpenDeck?: () => void;
  onOpenMore?: () => void;
  handCount?: number;
  stackCount?: number;
  passDisabled?: boolean;
  highlightPass?: boolean;
  highlightDeck?: boolean;
  deckLabel?: string;
  primaryMode?: MobilePrimaryActionMode;
  canKeepHand?: boolean;
  canMulligan?: boolean;
  canUnkeepHand?: boolean;
  mulligansTaken?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onUnkeepHand?: () => void;
}

interface DockButtonProps {
  label: string;
  badge?: number;
  highlight?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const DockButton: React.FC<DockButtonProps> = ({ label, badge, highlight, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      flex: 1,
      minHeight: 52,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      background: highlight
        ? `linear-gradient(180deg, ${colors.accentStrong}, ${colors.accent})`
        : colors.surfaceTransparent,
      color: highlight ? '#0b0b10' : disabled ? colors.textMuted : colors.textPrimary,
      border: `1px solid ${highlight ? colors.accentStrong : colors.borderSubtle}`,
      borderRadius: radii.md,
      boxShadow: highlight ? shadows.sm : 'none',
      fontSize: fontSize.sm,
      fontWeight: highlight ? 600 : 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      position: 'relative',
      padding: `${spacing.xs}px ${spacing.sm}px`,
    }}
  >
    <span>{label}</span>
    {typeof badge === 'number' && badge > 0 && (
      <span
        style={{
          position: 'absolute',
          top: 4,
          right: 8,
          minWidth: 18,
          height: 18,
          borderRadius: radii.pill,
          background: colors.danger,
          color: '#fff',
          fontSize: fontSize.xxs,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 4px',
        }}
      >
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);

export const MobileActionDock: React.FC<MobileActionDockProps> = ({
  onPassPriority,
  onOpenHand,
  onOpenStack,
  onOpenMana,
  onOpenDeck,
  onOpenMore,
  handCount,
  stackCount,
  passDisabled,
  highlightPass,
  highlightDeck,
  deckLabel = 'Deck',
  primaryMode = 'play',
  canKeepHand,
  canMulligan,
  canUnkeepHand,
  mulligansTaken,
  onKeepHand,
  onMulligan,
  onUnkeepHand,
}) => {
  const mulliganMode = primaryMode === 'mulligan' || primaryMode === 'unkeep';

  return (
    <div
      role="toolbar"
      aria-label={mulliganMode ? 'Opening hand actions' : 'Game actions'}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: z.dock,
        background: 'linear-gradient(180deg, rgba(37, 30, 20, 0.96), rgba(18, 16, 12, 0.98))',
        borderTop: `1px solid ${colors.borderStrong}`,
        boxShadow: shadows.lg,
        backdropFilter: 'blur(14px) saturate(130%)',
        display: 'flex',
        gap: spacing.xs,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        paddingBottom: `calc(${spacing.xs}px + ${safeArea.bottom})`,
        paddingLeft: `calc(${spacing.sm}px + ${safeArea.left})`,
        paddingRight: `calc(${spacing.sm}px + ${safeArea.right})`,
      }}
    >
      {mulliganMode && (
        <MobileMulliganActions
          mode={primaryMode === 'unkeep' ? 'unkeep' : 'mulligan'}
          canKeepHand={canKeepHand}
          canMulligan={canMulligan}
          canUnkeepHand={canUnkeepHand}
          mulligansTaken={mulligansTaken}
          onKeepHand={onKeepHand}
          onMulligan={onMulligan}
          onUnkeepHand={onUnkeepHand}
          fill
        />
      )}
      {!mulliganMode && onOpenDeck && (
        <DockButton label={deckLabel} highlight={highlightDeck} onClick={onOpenDeck} />
      )}
      {!mulliganMode && (
        <DockButton label="Pass" highlight={highlightPass} disabled={passDisabled} onClick={onPassPriority} />
      )}
      {onOpenHand && <DockButton label="Hand" badge={handCount} onClick={onOpenHand} />}
      {!mulliganMode && onOpenStack && <DockButton label="Stack" badge={stackCount} onClick={onOpenStack} />}
      {!mulliganMode && onOpenMana && <DockButton label="Mana" onClick={onOpenMana} />}
      {onOpenMore && <DockButton label="More" onClick={onOpenMore} />}
    </div>
  );
};
