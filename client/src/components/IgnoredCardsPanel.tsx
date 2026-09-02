/**
 * IgnoredCardsPanel.tsx
 * 
 * A panel for viewing and managing cards that are ignored for Smart Auto-Pass.
 * When a card is ignored, the auto-pass system will not consider it as a reason
 * to stop and wait for player action.
 * 
 * Supports cards from ALL zones:
 * - Battlefield (permanents)
 * - Hand
 * - Graveyard
 * - Exile
 * - Commander zone
 * - Library (top card if revealed)
 * 
 * Example use case: Elixir of Immortality with no cards in graveyard - player
 * can ignore it so they don't have to pass priority every phase.
 * 
 * Features:
 * - Shows all ignored cards with their images and zone
 * - Click ✕ to remove a card from the ignore list
 * - "Clear All" button to remove all ignored cards
 * - Collapsible/minimizable panel
 */

import React, { useState } from 'react';
import type { PlayerID } from '../../../shared/src';

export type IgnoredCardZone = 'battlefield' | 'hand' | 'graveyard' | 'exile' | 'commander' | 'library';

export interface IgnoredCard {
  permanentId: string;  // Can be cardId for non-battlefield zones
  cardId?: string;      // The actual card ID (useful when permanentId is different)
  cardName: string;
  imageUrl?: string;
  zone?: IgnoredCardZone;  // Which zone the card is in
}

interface Props {
  ignoredCards: IgnoredCard[];
  onUnignore: (cardId: string) => void;
  onClearAll: () => void;
  you?: PlayerID;
  variant?: 'overlay' | 'rail';
  railCollapsed?: boolean;
  onExpandRail?: () => void;
}

function renderIgnoredCardsRail(opts: {
  ignoredCards: IgnoredCard[];
  onUnignore: (cardId: string) => void;
  onClearAll: () => void;
  railCollapsed?: boolean;
  onExpandRail?: () => void;
}) {
  const { ignoredCards, onUnignore, onClearAll, railCollapsed, onExpandRail } = opts;

  if (railCollapsed) {
    return (
      <button
        type="button"
        onClick={() => onExpandRail?.()}
        title="Expand utility rail to manage ignored cards"
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #444',
          backgroundColor: '#2a2a2a',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        {ignoredCards.length} Ignored
      </button>
    );
  }

  return (
    <div
      style={{
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 8,
        padding: '8px 12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, color: '#ddd', fontWeight: 500 }}>
          Ignored
        </span>
        {ignoredCards.length > 1 && (
          <button
            type="button"
            onClick={onClearAll}
            style={{
              padding: '4px 8px',
              fontSize: 10,
              borderRadius: 4,
              border: '1px solid #444',
              background: '#252525',
              color: '#d1d5db',
              cursor: 'pointer',
            }}
          >
            Clear All
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {ignoredCards.map((card) => (
          <div
            key={card.cardId || card.permanentId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: '100%',
              minWidth: 0,
              padding: '4px 6px',
              background: '#252525',
              border: '1px solid #333',
              borderRadius: 6,
            }}
          >
            {card.imageUrl && (
              <img
                src={card.imageUrl}
                alt=""
                style={{
                  width: 18,
                  height: 24,
                  borderRadius: 2,
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
              />
            )}
            <span
              title={card.cardName}
              style={{
                fontSize: 11,
                color: '#ddd',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 120,
              }}
            >
              {card.cardName || 'Card'}
            </span>
            <button
              type="button"
              onClick={() => onUnignore(card.cardId ?? card.permanentId)}
              title="Stop ignoring this card"
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              X
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Get zone display info
 */
function getZoneInfo(zone?: IgnoredCardZone): { icon: string; label: string; color: string } {
  switch (zone) {
    case 'hand': return { icon: '🖐️', label: 'Hand', color: '#60a5fa' };
    case 'graveyard': return { icon: '⚰️', label: 'Graveyard', color: '#a78bfa' };
    case 'exile': return { icon: '🌀', label: 'Exile', color: '#f472b6' };
    case 'commander': return { icon: '👑', label: 'Commander', color: '#fbbf24' };
    case 'library': return { icon: '📚', label: 'Library', color: '#34d399' };
    case 'battlefield': 
    default: return { icon: '⚔️', label: 'Battlefield', color: '#f87171' };
  }
}

export function IgnoredCardsPanel({ ignoredCards, onUnignore, onClearAll, you, variant = 'overlay', railCollapsed = false, onExpandRail }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMinimized, setIsMinimized] = useState(true);

  // Don't render if no ignored cards
  if (!ignoredCards || ignoredCards.length === 0) {
    return null;
  }

  if (variant === 'rail') {
    return renderIgnoredCardsRail({
      ignoredCards,
      onUnignore,
      onClearAll,
      railCollapsed,
      onExpandRail,
    });
  }

  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        style={{
          position: 'fixed',
          bottom: 16,
          left: 16,
          background: 'linear-gradient(135deg, rgba(234,179,8,0.9), rgba(202,138,4,0.9))',
          border: '2px solid #facc15',
          borderRadius: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(234,179,8,0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        title="Click to expand ignored cards panel"
      >
        <span style={{ fontSize: 16 }}>🔇</span>
        <span style={{ color: 'white', fontWeight: 600, fontSize: 12 }}>
          {ignoredCards.length} Ignored
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        background: 'linear-gradient(135deg, rgba(30,30,50,0.95), rgba(40,40,70,0.95))',
        border: '2px solid #facc15',
        borderRadius: 12,
        padding: isCollapsed ? '8px 12px' : 16,
        minWidth: isCollapsed ? 180 : 260,
        maxWidth: 340,
        maxHeight: 400,
        overflowY: 'auto',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(234,179,8,0.3)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: isCollapsed ? 0 : 12,
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🔇</span>
          <span style={{
            fontSize: 14,
            fontWeight: 'bold',
            color: '#e5e7eb',
          }}>
            Ignored Cards
          </span>
          <span style={{
            background: '#facc15',
            color: '#1a1a2e',
            padding: '2px 8px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 'bold',
          }}>
            {ignoredCards.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(true);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 14,
              padding: '2px 6px',
            }}
            title="Minimize"
          >
            ─
          </button>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>
            {isCollapsed ? '▸' : '▾'}
          </span>
        </div>
      </div>

      {/* Collapsed view - just show count */}
      {isCollapsed ? (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          {ignoredCards.length} card{ignoredCards.length !== 1 ? 's' : ''} ignored for auto-pass
        </div>
      ) : (
        <>
          {/* Description */}
          <div style={{
            fontSize: 11,
            color: '#9ca3af',
            marginBottom: 12,
            paddingBottom: 8,
            borderBottom: '1px solid rgba(250,204,21,0.2)',
          }}>
            These cards are skipped during Smart Auto-Pass checks. Click ✕ to stop ignoring.
          </div>

          {/* Card list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ignoredCards.map((card) => {
              const zoneInfo = getZoneInfo(card.zone);
              return (
                <div
                  key={card.cardId || card.permanentId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    background: 'rgba(250,204,21,0.1)',
                    border: '1px solid rgba(250,204,21,0.3)',
                    borderRadius: 8,
                  }}
                >
                  {/* Card image */}
                  {card.imageUrl && (
                    <img
                      src={card.imageUrl}
                      alt={card.cardName}
                      style={{
                        width: 40,
                        height: 56,
                        borderRadius: 4,
                        objectFit: 'cover',
                        border: '1px solid rgba(255,255,255,0.2)',
                        flexShrink: 0,
                      }}
                    />
                  )}

                  {/* Card name and zone */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#e5e7eb',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {card.cardName}
                    </div>
                    <div style={{
                      fontSize: 10,
                      marginTop: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      <span style={{ color: zoneInfo.color }}>{zoneInfo.icon}</span>
                      <span style={{ color: zoneInfo.color }}>{zoneInfo.label}</span>
                      <span style={{ color: '#facc15', fontStyle: 'italic' }}>• Ignored</span>
                    </div>
                  </div>

                  {/* Unignore button */}
                  <button
                    onClick={() => onUnignore(card.cardId ?? card.permanentId)}
                    title="Stop ignoring this card"
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: '1px solid #ef4444',
                      background: 'rgba(239,68,68,0.2)',
                      color: '#fca5a5',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'all 0.2s',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = 'rgba(239,68,68,0.4)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = 'rgba(239,68,68,0.2)';
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* Clear all button */}
          {ignoredCards.length > 1 && (
            <button
              onClick={onClearAll}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '8px 12px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #6b7280',
                background: 'rgba(107,114,128,0.2)',
                color: '#d1d5db',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Clear All Ignored Cards
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default IgnoredCardsPanel;
