/**
 * IgnoredCardsPanel.tsx
 * 
 * A panel for viewing and managing cards that are ignored for Smart Auto-Pass.
 * When a card is ignored, the auto-pass system will not consider it as a reason
 * to stop and wait for player action.
 * 
 * Example use case: Elixir of Immortality with no cards in graveyard - player
 * can ignore it so they don't have to pass priority every phase.
 * 
 * Features:
 * - Shows all ignored cards with their images
 * - Click ✕ to remove a card from the ignore list
 * - "Clear All" button to remove all ignored cards
 * - Collapsible/minimizable panel
 */

import React, { useState } from 'react';
import type { PlayerID } from '../../../shared/src';

export interface IgnoredCard {
  permanentId: string;
  cardName: string;
  imageUrl?: string;
}

interface Props {
  ignoredCards: IgnoredCard[];
  onUnignore: (permanentId: string) => void;
  onClearAll: () => void;
  you?: PlayerID;
}

export function IgnoredCardsPanel({ ignoredCards, onUnignore, onClearAll, you }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Don't render if no ignored cards
  if (!ignoredCards || ignoredCards.length === 0) {
    return null;
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
            {ignoredCards.map((card) => (
              <div
                key={card.permanentId}
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

                {/* Card name */}
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
                    color: '#facc15',
                    marginTop: 2,
                    fontStyle: 'italic',
                  }}>
                    Ignored for auto-pass
                  </div>
                </div>

                {/* Unignore button */}
                <button
                  onClick={() => onUnignore(card.permanentId)}
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
            ))}
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
