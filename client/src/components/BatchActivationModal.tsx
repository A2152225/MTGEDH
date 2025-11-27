/**
 * BatchActivationModal.tsx
 * 
 * A modal for activating the same ability multiple times in sequence.
 * Useful for repetitive activations like Drowner of Secrets, token generators, etc.
 * 
 * Features:
 * - Set number of activations
 * - Preview total cost and effect
 * - Quick shortcuts (x2, x3, x5, max)
 */

import React, { useState, useMemo } from 'react';
import type { ParsedActivatedAbility } from '../utils/activatedAbilityParser';

export interface BatchActivationModalProps {
  open: boolean;
  ability: ParsedActivatedAbility;
  sourceName: string;
  sourceImageUrl?: string;
  // Limits
  maxActivations?: number;  // Max possible activations (based on available resources)
  // Callbacks
  onConfirm: (count: number) => void;
  onCancel: () => void;
}

/**
 * Calculate the total cost for multiple activations
 */
function calculateTotalCost(ability: ParsedActivatedAbility, count: number): string {
  const parts: string[] = [];
  
  // Mana cost (multiply by count)
  if (ability.manaCost) {
    // Parse mana symbols and multiply
    const manaSymbols = ability.manaCost.match(/\{[^}]+\}/g) || [];
    const genericMatch = ability.manaCost.match(/\{(\d+)\}/);
    
    if (genericMatch) {
      const genericPerActivation = parseInt(genericMatch[1], 10);
      const totalGeneric = genericPerActivation * count;
      if (totalGeneric > 0) {
        parts.push(`{${totalGeneric}}`);
      }
    }
    
    // Colored mana symbols
    const coloredSymbols = manaSymbols.filter(s => !/\{\d+\}/.test(s));
    if (coloredSymbols.length > 0) {
      parts.push(`${coloredSymbols.join('')} × ${count}`);
    }
  }
  
  if (ability.requiresTap) {
    parts.push(`Tap source × ${count}`);
  }
  
  if (ability.lifeCost) {
    parts.push(`Pay ${ability.lifeCost * count} life`);
  }
  
  if (ability.tapOtherPermanentsCost) {
    const tapCount = ability.tapOtherPermanentsCost.count * count;
    parts.push(`Tap ${tapCount} ${ability.tapOtherPermanentsCost.filter.types?.join('/')}${tapCount > 1 ? 's' : ''}`);
  }
  
  if (ability.requiresSacrifice) {
    parts.push(`Sacrifice × ${count}`);
  }
  
  return parts.join(', ') || 'Free';
}

export function BatchActivationModal({
  open,
  ability,
  sourceName,
  sourceImageUrl,
  maxActivations = 10,
  onConfirm,
  onCancel,
}: BatchActivationModalProps) {
  const [count, setCount] = useState(2);

  // Reset count when modal opens
  React.useEffect(() => {
    if (open) {
      setCount(Math.min(2, maxActivations));
    }
  }, [open, maxActivations]);

  const totalCost = useMemo(() => calculateTotalCost(ability, count), [ability, count]);

  const handleConfirm = () => {
    onConfirm(count);
  };

  const quickSelect = (n: number) => {
    setCount(Math.min(n, maxActivations));
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 20,
          maxWidth: 450,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {sourceImageUrl && (
            <div
              style={{
                width: 60,
                height: 84,
                borderRadius: 6,
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid #4a4a6a',
              }}
            >
              <img
                src={sourceImageUrl}
                alt={sourceName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#8b5cf6' }}>
              🔄 Batch Activation
            </h2>
            <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
              {sourceName}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#a0aec0' }}>
              {ability.label}: {ability.description}
            </div>
          </div>
        </div>

        {/* Activation Count */}
        <div
          style={{
            padding: 16,
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderRadius: 8,
            border: '1px solid rgba(139, 92, 246, 0.3)',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
            Number of activations:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setCount(Math.max(1, count - 1))}
              disabled={count <= 1}
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                border: 'none',
                backgroundColor: count <= 1 ? '#3a3a5a' : '#8b5cf6',
                color: '#fff',
                fontSize: 18,
                cursor: count <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={maxActivations}
              value={count}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 1;
                setCount(Math.min(Math.max(1, val), maxActivations));
              }}
              style={{
                width: 60,
                height: 36,
                textAlign: 'center',
                fontSize: 18,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid rgba(139, 92, 246, 0.5)',
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: '#fff',
              }}
            />
            <button
              onClick={() => setCount(Math.min(maxActivations, count + 1))}
              disabled={count >= maxActivations}
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                border: 'none',
                backgroundColor: count >= maxActivations ? '#3a3a5a' : '#8b5cf6',
                color: '#fff',
                fontSize: 18,
                cursor: count >= maxActivations ? 'not-allowed' : 'pointer',
              }}
            >
              +
            </button>
          </div>

          {/* Quick select buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {[2, 3, 5].filter(n => n <= maxActivations).map(n => (
              <button
                key={n}
                onClick={() => quickSelect(n)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: count === n ? '2px solid #8b5cf6' : '1px solid rgba(139, 92, 246, 0.3)',
                  backgroundColor: count === n ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                  color: '#fff',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ×{n}
              </button>
            ))}
            {maxActivations > 5 && (
              <button
                onClick={() => quickSelect(maxActivations)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: count === maxActivations ? '2px solid #8b5cf6' : '1px solid rgba(139, 92, 246, 0.3)',
                  backgroundColor: count === maxActivations ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                  color: '#fff',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Max ({maxActivations})
              </button>
            )}
          </div>
        </div>

        {/* Total Cost Preview */}
        <div
          style={{
            padding: 12,
            backgroundColor: 'rgba(0,0,0,0.3)',
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Total cost:</div>
          <div style={{ fontSize: 14, color: '#f59e0b', fontWeight: 500 }}>
            {totalCost}
          </div>
        </div>

        {/* Effect Preview */}
        {ability.isMillAbility && ability.millCount && (
          <div
            style={{
              padding: 12,
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderRadius: 6,
              marginBottom: 16,
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Total effect:</div>
            <div style={{ fontSize: 14, color: '#3b82f6', fontWeight: 500 }}>
              📚 Mill {ability.millCount * count} cards
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: 6,
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
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: '#8b5cf6',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Activate {count}×
          </button>
        </div>
      </div>
    </div>
  );
}

export default BatchActivationModal;
