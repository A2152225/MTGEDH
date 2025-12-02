/**
 * GraveyardSelectionModal.tsx
 * 
 * Modal for selecting cards from a graveyard for effects like:
 * - Elena Turk (return non-assassin historic card to hand)
 * - Red XIII (return equipment or aura to hand)
 * - Unfinished Business (return creature + up to 2 auras/equipment)
 */

import React, { useState, useMemo, useCallback } from 'react';

export interface GraveyardCard {
  id: string;
  name: string;
  typeLine?: string;
  manaCost?: string;
  imageUrl?: string;
}

export interface GraveyardSelectionModalProps {
  open: boolean;
  title: string;
  description: string;
  sourceCard?: {
    name: string;
    imageUrl?: string;
  };
  validTargets: GraveyardCard[];
  minTargets: number;
  maxTargets: number;
  onConfirm: (selectedIds: string[]) => void;
  onCancel: () => void;
}

export function GraveyardSelectionModal({
  open,
  title,
  description,
  sourceCard,
  validTargets,
  minTargets,
  maxTargets,
  onConfirm,
  onCancel,
}: GraveyardSelectionModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open]);

  const toggleSelect = useCallback((cardId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else if (next.size < maxTargets) {
        next.add(cardId);
      }
      return next;
    });
  }, [maxTargets]);

  const canConfirm = selectedIds.size >= minTargets && selectedIds.size <= maxTargets;

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm(Array.from(selectedIds));
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10003,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && minTargets === 0) {
          onCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 800,
          width: '95%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {sourceCard?.imageUrl && (
            <div
              style={{
                width: 80,
                height: 112,
                borderRadius: 6,
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid #4a4a6a',
              }}
            >
              <img
                src={sourceCard.imageUrl}
                alt={sourceCard.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#8b5cf6' }}>
              📜 {title}
            </h2>
            {sourceCard?.name && (
              <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
                {sourceCard.name}
              </div>
            )}
            <div
              style={{
                marginTop: 12,
                padding: 12,
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderRadius: 8,
                border: '1px solid rgba(139, 92, 246, 0.3)',
                fontSize: 13,
                color: '#a78bfa',
                lineHeight: 1.5,
              }}
            >
              {description}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: '#888' }}>
              {minTargets === maxTargets
                ? `Select ${minTargets} card${minTargets !== 1 ? 's' : ''}`
                : minTargets === 0
                ? `Select up to ${maxTargets} card${maxTargets !== 1 ? 's' : ''}`
                : `Select ${minTargets} to ${maxTargets} cards`}
              {selectedIds.size > 0 && (
                <span style={{ color: '#8b5cf6', fontWeight: 600 }}> • {selectedIds.size} selected</span>
              )}
            </div>
          </div>
        </div>

        {/* Cards Grid */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 8,
            backgroundColor: '#252540',
            padding: 16,
          }}
        >
          {validTargets.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                color: '#888',
              }}
            >
              No valid cards in graveyard.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {validTargets.map(card => {
                const isSelected = selectedIds.has(card.id);
                const canSelect = isSelected || selectedIds.size < maxTargets;

                return (
                  <div
                    key={card.id}
                    onClick={() => canSelect && toggleSelect(card.id)}
                    style={{
                      position: 'relative',
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: isSelected ? '3px solid #8b5cf6' : '2px solid #4a4a6a',
                      backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0,0,0,0.3)',
                      cursor: canSelect ? 'pointer' : 'not-allowed',
                      opacity: canSelect ? 1 : 0.5,
                      transition: 'all 0.15s',
                    }}
                  >
                    {card.imageUrl ? (
                      <img
                        src={card.imageUrl}
                        alt={card.name}
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          padding: 16,
                          minHeight: 160,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                          {card.name}
                        </div>
                        {card.typeLine && (
                          <div style={{ fontSize: 10, color: '#888' }}>
                            {card.typeLine}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          backgroundColor: '#8b5cf6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: 16,
                          fontWeight: 600,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
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
                        padding: '4px 6px',
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                        fontSize: 10,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#8b5cf6' : '#4a4a6a',
              color: canConfirm ? '#fff' : '#888',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}

export default GraveyardSelectionModal;
