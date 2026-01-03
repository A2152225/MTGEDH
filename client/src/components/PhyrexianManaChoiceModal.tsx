/**
 * PhyrexianManaChoiceModal.tsx
 * 
 * A modal for choosing how to pay Phyrexian mana costs.
 * Phyrexian mana (like {W/P}) can be paid with either:
 * - The colored mana (e.g., {W})
 * - 2 life
 * 
 * This modal allows players to choose their preferred payment method
 * for each Phyrexian mana symbol in a cost.
 * 
 * Example: Mite Overseer has "{3}{W/P}" - player chooses to pay the {W/P}
 * with either 1 white mana or 2 life.
 */

import React, { useState, useCallback, useEffect } from 'react';

export interface PhyrexianChoice {
  index: number;
  colorOption: string;
  colorName: string;
  lifeAmount: number;
  hasColorMana: boolean;
  symbol: string;
}

export interface PhyrexianManaChoiceModalProps {
  open: boolean;
  cardName: string;
  abilityText: string;
  totalManaCost: string;
  genericCost: number;
  phyrexianChoices: PhyrexianChoice[];
  playerLife: number;
  cardImageUrl?: string;
  onConfirm: (choices: Array<{ index: number; payWithLife: boolean }>) => void;
  onCancel: () => void;
}

const COLOR_DISPLAY: Record<string, { name: string; color: string; symbol: string }> = {
  W: { name: 'White', color: '#f9fae5', symbol: '☀️' },
  U: { name: 'Blue', color: '#0e68ab', symbol: '💧' },
  B: { name: 'Black', color: '#150b00', symbol: '💀' },
  R: { name: 'Red', color: '#d3202a', symbol: '🔥' },
  G: { name: 'Green', color: '#00733e', symbol: '🌲' },
};

export function PhyrexianManaChoiceModal({
  open,
  cardName,
  abilityText,
  totalManaCost,
  genericCost,
  phyrexianChoices,
  playerLife,
  cardImageUrl,
  onConfirm,
  onCancel,
}: PhyrexianManaChoiceModalProps) {
  // Track which Phyrexian costs will be paid with life
  const [payWithLifeFlags, setPayWithLifeFlags] = useState<Record<number, boolean>>({});
  
  // Reset choices when modal opens
  useEffect(() => {
    if (open) {
      // Default to paying with mana if available, otherwise life
      const initialFlags: Record<number, boolean> = {};
      for (const choice of phyrexianChoices) {
        initialFlags[choice.index] = !choice.hasColorMana;
      }
      setPayWithLifeFlags(initialFlags);
    }
  }, [open, phyrexianChoices]);

  const togglePaymentMethod = useCallback((index: number) => {
    setPayWithLifeFlags(prev => ({
      ...prev,
      [index]: !prev[index],
    }));
  }, []);

  const handleConfirm = useCallback(() => {
    const choices = phyrexianChoices.map(choice => ({
      index: choice.index,
      payWithLife: payWithLifeFlags[choice.index] ?? false,
    }));
    onConfirm(choices);
  }, [phyrexianChoices, payWithLifeFlags, onConfirm]);

  // Calculate totals
  const totalLifePayment = phyrexianChoices.reduce((sum, choice) => {
    return sum + (payWithLifeFlags[choice.index] ? choice.lifeAmount : 0);
  }, 0);
  
  const lifeAfterPayment = playerLife - totalLifePayment;
  const canAffordLifePayment = lifeAfterPayment > 0;

  if (!open) return null;

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
        zIndex: 10001,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#9b59b6' }}>
            Phyrexian Mana Payment
          </h2>
          <div style={{ fontSize: 14, color: '#888', marginTop: 4 }}>
            Choose how to pay for each Phyrexian mana symbol
          </div>
        </div>

        {/* Card info */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {cardImageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={cardImageUrl}
                alt={cardName}
                style={{
                  width: 120,
                  height: 'auto',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{cardName}</div>
            <div style={{ 
              fontSize: 13, 
              color: '#aaa',
              padding: '8px 12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
              marginBottom: 8,
            }}>
              {abilityText.length > 150 ? abilityText.slice(0, 150) + '...' : abilityText}
            </div>
            <div style={{ 
              fontSize: 14, 
              color: '#f1c40f',
              fontWeight: 500,
            }}>
              Cost: {totalManaCost}
            </div>
          </div>
        </div>

        {/* Phyrexian mana choices */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: 12,
          padding: '12px',
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
        }}>
          {phyrexianChoices.map((choice) => {
            const payWithLife = payWithLifeFlags[choice.index] ?? false;
            const colorInfo = COLOR_DISPLAY[choice.colorOption] || { name: choice.colorName, color: '#666', symbol: '✦' };
            
            return (
              <div 
                key={choice.index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  backgroundColor: payWithLife ? 'rgba(231, 76, 60, 0.2)' : 'rgba(46, 204, 113, 0.2)',
                  borderRadius: 8,
                  border: `2px solid ${payWithLife ? '#e74c3c' : '#2ecc71'}`,
                }}
              >
                {/* Phyrexian symbol */}
                <div style={{
                  fontSize: 24,
                  fontWeight: 700,
                  padding: '4px 8px',
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  borderRadius: 6,
                  color: colorInfo.color,
                  textShadow: '0 0 4px rgba(0,0,0,0.8)',
                }}>
                  {choice.symbol}
                </div>
                
                {/* Toggle buttons */}
                <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setPayWithLifeFlags(prev => ({ ...prev, [choice.index]: false }))}
                    disabled={!choice.hasColorMana}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: choice.hasColorMana ? 'pointer' : 'not-allowed',
                      fontWeight: 600,
                      fontSize: 13,
                      backgroundColor: !payWithLife ? '#2ecc71' : 'rgba(255,255,255,0.1)',
                      color: !payWithLife ? '#000' : '#888',
                      opacity: choice.hasColorMana ? 1 : 0.5,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {colorInfo.symbol} Pay {colorInfo.name}
                  </button>
                  <button
                    onClick={() => setPayWithLifeFlags(prev => ({ ...prev, [choice.index]: true }))}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                      backgroundColor: payWithLife ? '#e74c3c' : 'rgba(255,255,255,0.1)',
                      color: payWithLife ? '#fff' : '#888',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    ❤️ Pay {choice.lifeAmount} Life
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-around',
          padding: '12px 0',
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Current Life</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#2ecc71' }}>{playerLife}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Life to Pay</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#e74c3c' }}>
              {totalLifePayment > 0 ? `-${totalLifePayment}` : '0'}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>After Payment</div>
            <div style={{ 
              fontSize: 24, 
              fontWeight: 700, 
              color: lifeAfterPayment <= 5 ? '#e74c3c' : lifeAfterPayment <= 10 ? '#f1c40f' : '#3498db',
            }}>
              {lifeAfterPayment}
            </div>
          </div>
        </div>

        {/* Warning if low life */}
        {lifeAfterPayment <= 5 && lifeAfterPayment > 0 && (
          <div style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(231, 76, 60, 0.2)',
            borderRadius: 6,
            color: '#e74c3c',
            fontSize: 13,
            textAlign: 'center',
          }}>
            ⚠️ Warning: This will leave you at {lifeAfterPayment} life!
          </div>
        )}

        {!canAffordLifePayment && totalLifePayment > 0 && (
          <div style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(231, 76, 60, 0.3)',
            borderRadius: 6,
            color: '#e74c3c',
            fontSize: 13,
            textAlign: 'center',
            fontWeight: 600,
          }}>
            ❌ Cannot pay {totalLifePayment} life (you only have {playerLife})
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '12px 20px',
              borderRadius: 8,
              border: '1px solid #555',
              backgroundColor: 'transparent',
              color: '#ccc',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canAffordLifePayment && totalLifePayment > 0}
            style={{
              flex: 1,
              padding: '12px 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canAffordLifePayment || totalLifePayment === 0 ? '#9b59b6' : '#555',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: canAffordLifePayment || totalLifePayment === 0 ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (canAffordLifePayment || totalLifePayment === 0) {
                e.currentTarget.style.backgroundColor = '#8e44ad';
              }
            }}
            onMouseLeave={(e) => {
              if (canAffordLifePayment || totalLifePayment === 0) {
                e.currentTarget.style.backgroundColor = '#9b59b6';
              }
            }}
          >
            ✓ Confirm Payment
          </button>
        </div>
      </div>
    </div>
  );
}

export default PhyrexianManaChoiceModal;
