/**
 * AdditionalCostModal.tsx
 * 
 * Modal for selecting additional costs to cast a spell:
 * - Discard cards (e.g., Lightning Axe, Faithless Looting)
 * - Sacrifice permanents (e.g., Altar's Reap, Devastating Summons)
 * 
 * Features:
 * - Shows spell being cast and reason for cost
 * - Allows selecting cards to discard or permanents to sacrifice
 * - Validates selection count matches required amount
 */

import React, { useState, useCallback, useEffect } from 'react';

export interface AdditionalCostCard {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface AdditionalCostTarget {
  id: string;
  name: string;
  imageUrl?: string;
  typeLine?: string;
}

export interface AdditionalCostModalProps {
  open: boolean;
  cardId: string;
  cardName: string;
  costType: 'discard' | 'sacrifice';
  amount: number;
  title: string;
  description: string;
  imageUrl?: string;
  availableCards?: AdditionalCostCard[];  // For discard
  availableTargets?: AdditionalCostTarget[];  // For sacrifice
  effectId?: string;
  canCancel?: boolean;
  onConfirm: (selectedIds: string[]) => void;
  onCancel: () => void;
}

export function AdditionalCostModal({
  open,
  cardId,
  cardName,
  costType,
  amount,
  title,
  description,
  imageUrl,
  availableCards = [],
  availableTargets = [],
  effectId,
  canCancel = true,
  onConfirm,
  onCancel,
}: AdditionalCostModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
    }
  }, [open, cardId, effectId]);

  const handleToggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Don't allow selecting more than the required amount
        if (next.size < amount) {
          next.add(id);
        }
      }
      return next;
    });
  }, [amount]);

  const handleConfirm = useCallback(() => {
    if (selectedIds.size === amount) {
      onConfirm(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  }, [selectedIds, amount, onConfirm]);

  if (!open) return null;

  const options = costType === 'discard' ? availableCards : availableTargets;
  const canConfirm = selectedIds.size === amount;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10003,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 650,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#ef4444' }}>
            {title}
          </h2>
        </div>

        {/* Spell info */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {imageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={imageUrl}
                alt={cardName}
                style={{
                  width: 140,
                  height: 'auto',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#ef4444' }}>
              Casting {cardName}
            </div>
            <div style={{ 
              fontSize: 13, 
              color: '#ccc',
              padding: '10px 12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              lineHeight: 1.5,
            }}>
              {description}
            </div>
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              backgroundColor: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              fontSize: 13,
              color: '#fca5a5',
            }}>
              {costType === 'discard' ? '🎴' : '💀'} Select {amount} {costType === 'discard' ? 'card' : 'permanent'}{amount > 1 ? 's' : ''} ({selectedIds.size}/{amount})
            </div>
          </div>
        </div>

        {/* Selection grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 12,
          maxHeight: '400px',
          overflowY: 'auto',
          padding: '8px',
        }}>
          {options.map((option) => {
            const isSelected = selectedIds.has(option.id);
            const canSelect = selectedIds.size < amount || isSelected;
            
            return (
              <button
                key={option.id}
                onClick={() => canSelect && handleToggleSelection(option.id)}
                disabled={!canSelect}
                style={{
                  padding: 0,
                  borderRadius: 8,
                  border: isSelected ? '3px solid #ef4444' : '2px solid rgba(255,255,255,0.2)',
                  backgroundColor: isSelected ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                  cursor: canSelect ? 'pointer' : 'not-allowed',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.2s ease',
                  opacity: canSelect ? 1 : 0.5,
                  transform: isSelected ? 'scale(0.95)' : 'scale(1)',
                }}
              >
                {option.imageUrl ? (
                  <img
                    src={option.imageUrl}
                    alt={option.name}
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                      borderRadius: 6,
                    }}
                  />
                ) : (
                  <div style={{
                    padding: 16,
                    textAlign: 'center',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    minHeight: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        {option.name}
                      </div>
                      {(option as AdditionalCostTarget).typeLine && (
                        <div style={{ fontSize: 10, color: '#888' }}>
                          {(option as AdditionalCostTarget).typeLine}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Selection indicator */}
                {isSelected && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 'bold',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}>
                    ✓
                  </div>
                )}
                
                {/* Card name overlay */}
                {option.imageUrl && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '6px 8px',
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    fontSize: 11,
                    fontWeight: 600,
                    textAlign: 'center',
                    borderBottomLeftRadius: 6,
                    borderBottomRightRadius: 6,
                  }}>
                    {option.name}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Warning if nothing available */}
        {options.length === 0 && (
          <div style={{
            padding: '16px',
            backgroundColor: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            textAlign: 'center',
            color: '#fca5a5',
          }}>
            No {costType === 'discard' ? 'cards' : 'permanents'} available to {costType}.
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
          {canCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #555',
                backgroundColor: 'transparent',
                color: '#aaa',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#ef4444' : '#444',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: canConfirm ? 1 : 0.5,
            }}
          >
            {costType === 'discard' ? 'Discard' : 'Sacrifice'} {amount} ({selectedIds.size}/{amount})
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdditionalCostModal;
