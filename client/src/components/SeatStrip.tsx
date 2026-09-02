/**
 * Horizontal player focus strip — click a seat to center the board (desktop and mobile).
 */

import React from 'react';
import type { PlayerID, PlayerRef } from '../../../shared/src';
import { colors, fontSize, radii, spacing } from '../theme';
import { lifeTotalColor, readPlayerLife } from '../utils/gameDisplayHelpers';

export interface SeatStripProps {
  players: PlayerRef[];
  you?: PlayerID;
  turnPlayer?: PlayerID | null;
  focusedPlayerId?: PlayerID | null;
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  life?: Record<string, number>;
  onFocusPlayer: (playerId: PlayerID) => void;
  onClearFocus?: () => void;
}

function seatBadge(playerId: PlayerID, monarch?: PlayerID | null, initiative?: PlayerID | null): string | null {
  if (monarch === playerId) return '👑';
  if (initiative === playerId) return '⚔️';
  return null;
}

export const SeatStrip: React.FC<SeatStripProps> = ({
  players,
  you,
  turnPlayer,
  focusedPlayerId,
  monarch,
  initiative,
  life,
  onFocusPlayer,
  onClearFocus,
}) => {
  const activePlayers = [...players]
    .filter((p) => !p.isSpectator && !p.inactive)
    .sort((a, b) => a.seat - b.seat);

  if (activePlayers.length === 0) return null;

  const isOverviewActive = !focusedPlayerId;

  return (
    <div
      role="tablist"
      aria-label="Player focus"
      style={{
        display: 'flex',
        gap: spacing.xs,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollSnapType: 'x proximity',
        padding: `${spacing.xs}px 0`,
        marginBottom: spacing.xs,
      }}
    >
      {onClearFocus && (
        <button
          type="button"
          role="tab"
          aria-selected={isOverviewActive}
          onClick={onClearFocus}
          style={{
            flex: '0 0 auto',
            scrollSnapAlign: 'start',
            minHeight: 32,
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: radii.lg,
            border: isOverviewActive
              ? `1px solid ${colors.accentStrong}`
              : `1px solid ${colors.borderSubtle}`,
            background: isOverviewActive
              ? 'rgba(59,130,246,0.22)'
              : colors.surfaceTransparent,
            boxShadow: 'none',
            color: colors.textPrimary,
            fontSize: fontSize.sm,
            fontWeight: isOverviewActive ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
          title="Zoom out and pan the full table"
        >
          Overview
        </button>
      )}
      {activePlayers.map((player) => {
        const isYou = player.id === you;
        const isTurn = player.id === turnPlayer;
        const isFocused = player.id === focusedPlayerId;
        const badge = seatBadge(player.id, monarch, initiative);
        const label = isYou ? 'You' : player.name.split(/\s+/)[0] || player.name;
        const playerLife = readPlayerLife(life, player.id);

        return (
          <button
            key={player.id}
            type="button"
            role="tab"
            aria-selected={isFocused}
            onClick={() => onFocusPlayer(player.id)}
            style={{
              flex: '0 0 auto',
              scrollSnapAlign: 'start',
              minHeight: 32,
              padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radii.lg,
              border: isFocused
                ? `1px solid ${colors.accentStrong}`
                : `1px solid ${colors.borderSubtle}`,
              background: isFocused
                ? 'rgba(59,130,246,0.22)'
                : colors.surfaceTransparent,
              boxShadow: isTurn ? 'inset 0 -2px 0 #34d399' : 'none',
              color: colors.textPrimary,
              fontSize: fontSize.sm,
              fontWeight: isFocused ? 600 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
            }}
            title={isFocused ? `Unfocus ${player.name}` : `Focus ${player.name}`}
          >
            {isTurn && (
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: radii.pill,
                  background: '#34d399',
                  boxShadow: '0 0 6px #34d399',
                  flexShrink: 0,
                }}
              />
            )}
            <span>{label}</span>
            <span
              style={{
                fontSize: fontSize.xs,
                fontWeight: 700,
                color: lifeTotalColor(playerLife),
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {playerLife}
            </span>
            {badge && <span aria-hidden style={{ fontSize: fontSize.xs }}>{badge}</span>}
          </button>
        );
      })}
    </div>
  );
};
