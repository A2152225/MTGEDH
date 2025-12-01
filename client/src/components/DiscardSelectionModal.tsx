import React, { useMemo, useState, useEffect } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

/**
 * Modal for selecting which cards to discard during the cleanup step.
 * This is shown when a player has more cards in hand than their maximum hand size.
 */
export interface DiscardSelectionModalProps {
  open: boolean;
  hand: KnownCardRef[];
  discardCount: number; // How many cards must be discarded
  maxHandSize: number;
  onConfirm: (cardIds: string[]) => void;
  onCancel?: () => void; // Optional - during cleanup, player must discard
}

export function DiscardSelectionModal({
  open,
  hand,
  discardCount,
  maxHandSize,
  onConfirm,
  onCancel,
}: DiscardSelectionModalProps) {
  const [selected, setSelected] = useState<string[]>([]);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelected([]);
    }
  }, [open]);

  const cardById = useMemo(() => new Map(hand.map((c) => [c.id, c])), [hand]);

  const toggleCard = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      // Don't allow selecting more than needed
      if (prev.length >= discardCount) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const canConfirm = selected.length === discardCount;

  if (!open) return null;

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
        <h3 style={{ margin: '0 0 12px 0', color: '#fc8181' }}>
          Cleanup Step - Discard to Hand Size
        </h3>
        <p style={{ fontSize: 14, color: '#a0aec0', marginBottom: 16 }}>
          You have {hand.length} cards in hand. Maximum hand size is {maxHandSize}.
          <br />
          Select {discardCount} card{discardCount !== 1 ? 's' : ''} to discard.
          <br />
          Selected: {selected.length} / {discardCount}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 10,
            maxHeight: '50vh',
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {hand.map((card) => {
            const isSelected = selected.includes(card.id);
            const img =
              card.image_uris?.small ||
              card.image_uris?.normal ||
              (card as any).image_uris?.art_crop;
            return (
              <div
                key={card.id}
                onClick={() => toggleCard(card.id)}
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
                  border: isSelected ? '3px solid #fc8181' : '2px solid #333',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  opacity: isSelected ? 1 : 0.85,
                  boxShadow: isSelected ? '0 0 8px #fc8181' : 'none',
                  transition: 'all 0.15s ease',
                  background: '#0a0a0a',
                }}
                title={card.name}
              >
                {img ? (
                  <img
                    src={img}
                    alt={card.name}
                    draggable={false}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      pointerEvents: 'none',
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
                      pointerEvents: 'none',
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
                      background: '#fc8181',
                      color: '#000',
                      borderRadius: '50%',
                      width: 22,
                      height: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                      pointerEvents: 'none',
                    }}
                  >
                    ✓
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 16,
          }}
        >
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                background: '#4a5568',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => onConfirm(selected)}
            disabled={!canConfirm}
            style={{
              background: canConfirm ? '#e53e3e' : '#2d3748',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              opacity: canConfirm ? 1 : 0.6,
            }}
          >
            Discard Selected
          </button>
        </div>
      </div>
    </div>
  );
}

export default DiscardSelectionModal;
