import React from 'react';

/**
 * Keep / Mulligan overlay shown at the top of the play area, including the
 * optional Serum Powder action when the player could still mulligan.
 */
export interface MulliganDecisionBarProps {
  showMulliganUI?: boolean;
  hasKeptHand?: boolean;
  mulligansTaken?: number;
  pendingBottomCount?: number;
  canKeepHand?: boolean;
  canMulligan?: boolean;
  isPreGame?: boolean;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onRandomizeStart?: () => void;
  canUseSerumPowder?: boolean;
  onSerumPowder?: () => void;
}

const buttonStyle = (enabled: boolean, background: string): React.CSSProperties => ({
  background: enabled ? background : '#4b5563',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  padding: '6px 14px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.5,
  fontSize: 12,
  fontWeight: 500,
});

export function MulliganDecisionBar({
  showMulliganUI,
  hasKeptHand,
  mulligansTaken = 0,
  pendingBottomCount = 0,
  canKeepHand,
  canMulligan,
  isPreGame,
  onKeepHand,
  onMulligan,
  onRandomizeStart,
  canUseSerumPowder,
  onSerumPowder,
}: MulliganDecisionBarProps) {
  if (!showMulliganUI) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 12,
        right: 12,
        zIndex: 200,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        padding: '6px 12px',
        borderRadius: 8,
        border: !hasKeptHand && !isPreGame ? '2px solid #ef4444' : '1px solid rgba(167, 139, 250, 0.6)',
        background: !hasKeptHand && !isPreGame
          ? 'rgba(239, 68, 68, 0.15)'
          : 'rgba(30, 30, 50, 0.95)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        color: '#fff',
        pointerEvents: 'auto',
      }}
    >
      {hasKeptHand ? (
        <span style={{ fontSize: 13, color: '#a78bfa', fontWeight: 500 }}>
          {'\u2713'} Hand kept{mulligansTaken > 0 ? ` (${7 - mulligansTaken} cards)` : ''}
        </span>
      ) : pendingBottomCount > 0 ? (
        <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 500 }}>
          Select {pendingBottomCount} card{pendingBottomCount !== 1 ? 's' : ''} to put on bottom...
        </span>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {!isPreGame && (
              <span style={{ fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
                {'\u26A0\uFE0F'} Keep your hand to continue!
              </span>
            )}
            <span style={{ fontSize: 12, color: '#c4b5fd' }}>
              Mulligans: {mulligansTaken}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={onKeepHand}
              disabled={!canKeepHand}
              style={buttonStyle(!!canKeepHand, '#10b981')}
            >
              Keep Hand
            </button>
            <button
              onClick={onMulligan}
              disabled={!canMulligan}
              style={buttonStyle(!!canMulligan, '#f59e0b')}
            >
              Mulligan
            </button>
            {canUseSerumPowder && onSerumPowder && (
              <button
                onClick={onSerumPowder}
                style={buttonStyle(true, '#6366f1')}
                title="Exile your hand, then draw that many cards. You may still keep or mulligan afterward."
              >
                Exile hand, draw that many
              </button>
            )}
            {isPreGame && onRandomizeStart && (
              <button
                onClick={onRandomizeStart}
                style={buttonStyle(true, '#8b5cf6')}
                title="Randomly select which player goes first"
              >
                {'\uD83C\uDFB2'} Random Start
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default MulliganDecisionBar;
