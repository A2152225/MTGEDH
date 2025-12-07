/**
 * ManaDistributionModal.tsx
 * 
 * Modal for distributing mana among multiple colors (e.g., Selvala, Heart of the Wilds)
 * Allows player to choose how to distribute X mana among W, U, B, R, G
 */

import React, { useState, useMemo, useCallback } from 'react';

export interface ManaDistributionModalProps {
  open: boolean;
  cardName: string;
  cardImageUrl?: string;
  totalAmount: number;
  availableColors: string[]; // e.g., ['W', 'U', 'B', 'R', 'G']
  message?: string;
  onConfirm: (distribution: Record<string, number>) => void;
  onCancel: () => void;
}

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

const COLOR_SYMBOLS: Record<string, string> = {
  W: '☀️',
  U: '💧',
  B: '💀',
  R: '🔥',
  G: '🌿',
};

export function ManaDistributionModal({
  open,
  cardName,
  cardImageUrl,
  totalAmount,
  availableColors,
  message,
  onConfirm,
  onCancel,
}: ManaDistributionModalProps) {
  // State: distribution[color] = amount
  const [distribution, setDistribution] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    availableColors.forEach(c => initial[c] = 0);
    return initial;
  });

  // Calculate remaining mana
  const allocated = useMemo(() => {
    return Object.values(distribution).reduce((sum, val) => sum + val, 0);
  }, [distribution]);

  const remaining = totalAmount - allocated;

  // Increment a color
  const increment = useCallback((color: string) => {
    if (remaining > 0) {
      setDistribution(prev => ({ ...prev, [color]: (prev[color] || 0) + 1 }));
    }
  }, [remaining]);

  // Decrement a color
  const decrement = useCallback((color: string) => {
    setDistribution(prev => {
      const current = prev[color] || 0;
      if (current > 0) {
        return { ...prev, [color]: current - 1 };
      }
      return prev;
    });
  }, []);

  // Set a specific amount
  const setValue = useCallback((color: string, value: number) => {
    const val = Math.max(0, Math.min(value, totalAmount));
    setDistribution(prev => ({ ...prev, [color]: val }));
  }, [totalAmount]);

  // Quick fill all remaining to one color
  const fillColor = useCallback((color: string) => {
    setDistribution(prev => ({ ...prev, [color]: (prev[color] || 0) + remaining }));
  }, [remaining]);

  const handleConfirm = useCallback(() => {
    if (allocated === totalAmount) {
      onConfirm(distribution);
    }
  }, [allocated, totalAmount, distribution, onConfirm]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
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
          maxWidth: 500,
          width: '90%',
          color: '#e0e0e0',
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', fontSize: 20, color: '#fff' }}>
          Distribute Mana - {cardName}
        </h2>
        {message && (
          <p style={{ margin: '0 0 16px 0', fontSize: 14, color: '#bbb' }}>{message}</p>
        )}

        <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 'bold' }}>
          Total: {totalAmount} mana | Allocated: {allocated} | Remaining: {remaining}
        </div>

        {remaining > 0 && (
          <div style={{ marginBottom: 12, padding: 8, background: '#2a2a3e', borderRadius: 6, fontSize: 13, color: '#ffcc00' }}>
            ⚠️ You must allocate all {totalAmount} mana before confirming
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {availableColors.map(color => (
            <div key={color} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 15 }}>
                {COLOR_SYMBOLS[color]} {COLOR_NAMES[color]}
              </div>
              <button
                onClick={() => decrement(color)}
                disabled={distribution[color] === 0}
                style={{
                  width: 32,
                  height: 32,
                  background: distribution[color] === 0 ? '#333' : '#444',
                  color: distribution[color] === 0 ? '#666' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: distribution[color] === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 18,
                }}
              >
                −
              </button>
              <input
                type="number"
                value={distribution[color] || 0}
                onChange={(e) => setValue(color, parseInt(e.target.value, 10) || 0)}
                min={0}
                max={totalAmount}
                style={{
                  width: 60,
                  padding: 6,
                  textAlign: 'center',
                  background: '#2a2a3e',
                  color: '#fff',
                  border: '1px solid #444',
                  borderRadius: 4,
                  fontSize: 15,
                }}
              />
              <button
                onClick={() => increment(color)}
                disabled={remaining === 0}
                style={{
                  width: 32,
                  height: 32,
                  background: remaining === 0 ? '#333' : '#444',
                  color: remaining === 0 ? '#666' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: remaining === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 18,
                }}
              >
                +
              </button>
              {remaining > 0 && (
                <button
                  onClick={() => fillColor(color)}
                  style={{
                    padding: '4px 8px',
                    background: '#2b6cb0',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Fill
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={allocated !== totalAmount}
            style={{
              padding: '8px 16px',
              background: allocated === totalAmount ? '#2b6cb0' : '#333',
              color: allocated === totalAmount ? '#fff' : '#666',
              border: 'none',
              borderRadius: 6,
              cursor: allocated === totalAmount ? 'pointer' : 'not-allowed',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
