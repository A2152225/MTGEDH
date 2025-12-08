/**
 * SquadCostModal.tsx
 * 
 * Modal for selecting how many times to pay the squad cost.
 * Squad is a keyword ability that lets you pay an additional cost any number of times
 * to create that many token copies of the spell when it enters the battlefield.
 * 
 * Features:
 * - Shows the squad creature being cast
 * - Displays the squad cost per copy
 * - Allows player to select 0 or more times to pay the cost
 * - Shows total mana required based on selection
 * - Validates player has enough mana to pay
 */

import React, { useState, useCallback, useEffect } from 'react';

export interface SquadCostModalProps {
  open: boolean;
  cardId: string;
  cardName: string;
  squadCost: string; // Mana cost like "{1}{W}"
  imageUrl?: string;
  effectId?: string;
  availableMana?: Record<string, number>; // Player's current mana pool
  onConfirm: (timesPaid: number) => void;
  onCancel: () => void;
}

export function SquadCostModal({
  open,
  cardId,
  cardName,
  squadCost,
  imageUrl,
  effectId,
  availableMana = {},
  onConfirm,
  onCancel,
}: SquadCostModalProps) {
  const [timesPaid, setTimesPaid] = useState<number>(0);

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setTimesPaid(0);
    }
  }, [open, cardId, effectId]);

  // Parse squad cost to calculate total mana needed
  const parseManaCost = useCallback((cost: string): Record<string, number> => {
    const mana: Record<string, number> = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };

    // Match mana symbols like {1}, {W}, {U}, {B}, {R}, {G}, {C}
    const matches = cost.matchAll(/\{([WUBRGC0-9]+)\}/g);
    for (const match of matches) {
      const symbol = match[1];
      if (/^\d+$/.test(symbol)) {
        // Generic mana
        mana.colorless += parseInt(symbol, 10);
      } else {
        // Colored/colorless mana
        const colorMap: Record<string, string> = {
          W: 'white',
          U: 'blue',
          B: 'black',
          R: 'red',
          G: 'green',
          C: 'colorless',
        };
        const color = colorMap[symbol];
        if (color) {
          mana[color]++;
        }
      }
    }

    return mana;
  }, []);

  const squadMana = parseManaCost(squadCost);
  
  // Calculate total mana needed for current selection
  const totalManaNeeded = Object.entries(squadMana).reduce((acc, [color, amount]) => {
    acc[color] = amount * timesPaid;
    return acc;
  }, {} as Record<string, number>);

  // Check if player can afford the current selection
  const canAfford = Object.entries(totalManaNeeded).every(([color, needed]) => {
    return (availableMana[color] || 0) >= needed;
  });

  // Calculate maximum times player can afford to pay
  const maxAffordable = Math.min(
    ...Object.entries(squadMana)
      .filter(([_, amount]) => amount > 0)
      .map(([color, amount]) => Math.floor((availableMana[color] || 0) / amount))
  );

  const handleIncrement = useCallback(() => {
    setTimesPaid(prev => Math.min(prev + 1, maxAffordable));
  }, [maxAffordable]);

  const handleDecrement = useCallback(() => {
    setTimesPaid(prev => Math.max(prev - 1, 0));
  }, []);

  const handleConfirm = useCallback(() => {
    if (canAfford || timesPaid === 0) {
      onConfirm(timesPaid);
      setTimesPaid(0);
    }
  }, [timesPaid, canAfford, onConfirm]);

  if (!open) return null;

  // Format mana cost for display
  const formatManaCost = (cost: string) => {
    return cost.replace(/\{([WUBRGC0-9]+)\}/g, (_, symbol) => {
      const colorMap: Record<string, string> = {
        W: '⚪',
        U: '🔵',
        B: '⚫',
        R: '🔴',
        G: '🟢',
        C: '◇',
      };
      return colorMap[symbol] || `{${symbol}}`;
    });
  };

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
          maxWidth: 550,
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
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#3b82f6' }}>
            ⚔️ Squad Payment
          </h2>
        </div>

        {/* Card info */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {imageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={imageUrl}
                alt={cardName}
                style={{
                  width: 160,
                  height: 'auto',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#3b82f6' }}>
              {cardName}
            </div>
            <div style={{ 
              fontSize: 13, 
              color: '#ccc',
              padding: '10px 12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              lineHeight: 1.5,
            }}>
              <strong>Squad {formatManaCost(squadCost)}</strong>
              <div style={{ marginTop: 6, fontSize: 12, color: '#999' }}>
                As an additional cost to cast this spell, you may pay {formatManaCost(squadCost)} any number of times. 
                When this creature enters the battlefield, create that many token copies of it.
              </div>
            </div>
          </div>
        </div>

        {/* Payment selector */}
        <div style={{
          padding: '20px',
          backgroundColor: 'rgba(59,130,246,0.1)',
          border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#93c5fd' }}>
            How many times do you want to pay {formatManaCost(squadCost)}?
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <button
              onClick={handleDecrement}
              disabled={timesPaid === 0}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: 'none',
                backgroundColor: timesPaid === 0 ? '#444' : '#3b82f6',
                color: '#fff',
                cursor: timesPaid === 0 ? 'not-allowed' : 'pointer',
                fontSize: 20,
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: timesPaid === 0 ? 0.5 : 1,
              }}
            >
              −
            </button>
            
            <div style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 32,
              fontWeight: 'bold',
              color: '#3b82f6',
              padding: '8px',
              backgroundColor: 'rgba(59,130,246,0.1)',
              borderRadius: 8,
            }}>
              {timesPaid}
            </div>
            
            <button
              onClick={handleIncrement}
              disabled={timesPaid >= maxAffordable}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: 'none',
                backgroundColor: timesPaid >= maxAffordable ? '#444' : '#3b82f6',
                color: '#fff',
                cursor: timesPaid >= maxAffordable ? 'not-allowed' : 'pointer',
                fontSize: 20,
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: timesPaid >= maxAffordable ? 0.5 : 1,
              }}
            >
              +
            </button>
          </div>

          {timesPaid > 0 && (
            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              fontSize: 13,
            }}>
              <div style={{ marginBottom: 6, color: '#93c5fd' }}>
                Total cost: {formatManaCost(squadCost)} × {timesPaid}
              </div>
              <div style={{ fontSize: 14, color: canAfford ? '#86efac' : '#fca5a5' }}>
                {canAfford ? '✓ Mana available' : '✗ Not enough mana'}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#ccc' }}>
                You will create {timesPaid} token {timesPaid === 1 ? 'copy' : 'copies'} when {cardName} enters the battlefield.
              </div>
            </div>
          )}

          {timesPaid === 0 && (
            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              fontSize: 13,
              color: '#999',
              textAlign: 'center',
            }}>
              No additional tokens will be created. (You can pay 0 times)
            </div>
          )}

          {maxAffordable === 0 && (
            <div style={{
              marginTop: 12,
              padding: '10px',
              backgroundColor: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              fontSize: 12,
              color: '#fca5a5',
              textAlign: 'center',
            }}>
              You don't have enough mana to pay the squad cost.
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
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
          <button
            onClick={handleConfirm}
            disabled={!canAfford && timesPaid > 0}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: (canAfford || timesPaid === 0) ? '#3b82f6' : '#444',
              color: '#fff',
              cursor: (canAfford || timesPaid === 0) ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: (canAfford || timesPaid === 0) ? 1 : 0.5,
            }}
          >
            {timesPaid === 0 ? 'Cast Without Squad' : `Pay ${timesPaid} Time${timesPaid > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SquadCostModal;
