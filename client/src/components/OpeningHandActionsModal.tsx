/**
 * OpeningHandActionsModal.tsx
 * 
 * A modal for handling opening hand actions after mulligan phase.
 * Specifically for Leyline-type cards that can begin the game on the battlefield.
 * 
 * Per MTG Rules 103.6: After mulligans, players may take opening hand actions
 * in turn order, starting with the starting player.
 */

import React, { useState, useMemo } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface OpeningHandActionsModalProps {
  open: boolean;
  hand: KnownCardRef[];
  onConfirm: (selectedCardIds: string[]) => void;
  onSkip: () => void;
}

/**
 * Check if a card has a Leyline-style opening hand ability
 * 
 * MTG rules: "If ~ is in your opening hand, you may begin the game with it on the battlefield."
 * This matches cards like Leyline of the Void, Leyline of Sanctity, etc.
 * Also matches Gemstone Caverns.
 */
function isLeylineCard(card: KnownCardRef): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  
  // Check for the specific Leyline ability text pattern
  const hasLeylineAbility = (
    oracleText.includes('in your opening hand') &&
    (oracleText.includes('begin the game with') || oracleText.includes('begin the game with it on the battlefield'))
  );
  
  // Also match by card name for known Leylines (as a backup)
  const isKnownLeyline = cardName.startsWith('leyline of') || cardName === 'gemstone caverns';
  
  return hasLeylineAbility || isKnownLeyline;
}

export function OpeningHandActionsModal({
  open,
  hand,
  onConfirm,
  onSkip,
}: OpeningHandActionsModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Find Leyline cards in hand
  const leylineCards = useMemo(() => {
    return hand.filter(card => isLeylineCard(card));
  }, [hand]);

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open]);

  const toggleSelect = (cardId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedIds));
  };

  if (!open) return null;

  // If no Leyline cards, auto-skip
  if (leylineCards.length === 0) {
    // We'll let the parent component handle this, but show a brief message
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          zIndex: 8000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            background: '#1e1e1e',
            borderRadius: 12,
            padding: 24,
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 16px 0' }}>No cards with opening hand abilities found.</p>
          <button
            onClick={onSkip}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 20px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 8000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#1e1e1e',
          borderRadius: 12,
          width: 700,
          maxWidth: '95vw',
          padding: 20,
          color: '#fff',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', color: '#a78bfa' }}>
          🔮 Opening Hand Actions
        </h3>
        <p style={{ fontSize: 14, color: '#a0aec0', marginBottom: 16 }}>
          You may begin the game with these cards on the battlefield.
          <br />
          Select any you wish to put into play, or skip to keep them in your hand.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
            maxHeight: '50vh',
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {leylineCards.map((card) => {
            const isSelected = selectedIds.has(card.id);
            const img =
              card.image_uris?.small ||
              card.image_uris?.normal ||
              (card as any).image_uris?.art_crop;
            return (
              <div
                key={card.id}
                onClick={() => toggleSelect(card.id)}
                onMouseEnter={(e) =>
                  showCardPreview(e.currentTarget as HTMLElement, card, {
                    prefer: 'above',
                    anchorPadding: 0,
                  })
                }
                onMouseLeave={(e) =>
                  hideCardPreview(e.currentTarget as HTMLElement)
                }
                style={{
                  position: 'relative',
                  aspectRatio: '0.72',
                  border: isSelected ? '3px solid #a78bfa' : '2px solid #333',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  opacity: isSelected ? 1 : 0.85,
                  boxShadow: isSelected ? '0 0 12px #a78bfa' : 'none',
                  transition: 'all 0.15s ease',
                  background: '#0a0a0a',
                }}
                title={card.name}
              >
                {img ? (
                  <img
                    src={img}
                    alt={card.name}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#eee',
                      fontSize: 11,
                      padding: 4,
                      textAlign: 'center',
                    }}
                  >
                    {card.name}
                  </div>
                )}
                {isSelected && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      background: '#a78bfa',
                      color: '#000',
                      borderRadius: '50%',
                      width: 24,
                      height: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    ✓
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                    padding: '16px 6px 6px 6px',
                    fontSize: 11,
                    textAlign: 'center',
                    fontWeight: 500,
                  }}
                >
                  {card.name}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 12, color: '#888' }}>
            {selectedIds.size > 0
              ? `${selectedIds.size} card${selectedIds.size > 1 ? 's' : ''} selected to put on battlefield`
              : 'No cards selected'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onSkip}
              style={{
                background: '#4a5568',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: 'pointer',
              }}
            >
              Skip
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
              style={{
                background: selectedIds.size > 0 ? '#a78bfa' : '#2d3748',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                opacity: selectedIds.size > 0 ? 1 : 0.6,
              }}
            >
              Put on Battlefield
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OpeningHandActionsModal;
