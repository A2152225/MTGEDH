/**
 * LifePaymentModal.tsx
 * 
 * A modal for choosing how much life to pay for spells like Toxic Deluge,
 * Hatred, Fire Covenant, etc. that have "pay X life" as part of their effect.
 * 
 * Features:
 * - Slider to choose life amount
 * - Shows current life and result after payment
 * - Validates min/max payment bounds
 * - Shows card image and effect description
 */

import React, { useState, useCallback } from 'react';

export interface LifePaymentModalProps {
  open: boolean;
  cardName: string;
  description: string;
  cardImageUrl?: string;
  currentLife: number;
  minPayment: number;
  maxPayment: number;
  onConfirm: (lifePayment: number) => void;
  onCancel: () => void;
}

export function LifePaymentModal({
  open,
  cardName,
  description,
  cardImageUrl,
  currentLife,
  minPayment,
  maxPayment,
  onConfirm,
  onCancel,
}: LifePaymentModalProps) {
  const [selectedAmount, setSelectedAmount] = useState(minPayment);
  
  // Reset selected amount when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedAmount(minPayment);
    }
  }, [open, minPayment]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedAmount(parseInt(e.target.value, 10));
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(selectedAmount);
  }, [selectedAmount, onConfirm]);

  const lifeAfterPayment = currentLife - selectedAmount;
  const canConfirm = selectedAmount >= minPayment && selectedAmount <= maxPayment;

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
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
          maxWidth: 450,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#e74c3c' }}>
            Pay Life for {cardName}
          </h2>
        </div>

        {/* Card image and description */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {cardImageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={cardImageUrl}
                alt={cardName}
                style={{
                  width: 130,
                  height: 'auto',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, color: '#ccc', marginBottom: 8 }}>
              {description}
            </div>
            <div style={{ 
              fontSize: 13, 
              color: '#888', 
              padding: '8px 12px',
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 6,
            }}>
              Choose how much life to pay (X = {selectedAmount})
            </div>
          </div>
        </div>

        {/* Life display */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-around',
          padding: '12px 0',
          backgroundColor: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Current Life</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#2ecc71' }}>{currentLife}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Paying</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#e74c3c' }}>−{selectedAmount}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>After</div>
            <div style={{ 
              fontSize: 24, 
              fontWeight: 700, 
              color: lifeAfterPayment <= 0 ? '#e74c3c' : lifeAfterPayment <= 5 ? '#f39c12' : '#3498db' 
            }}>
              {lifeAfterPayment}
            </div>
          </div>
        </div>

        {/* Slider */}
        <div style={{ padding: '0 8px' }}>
          <input
            type="range"
            min={minPayment}
            max={maxPayment}
            value={selectedAmount}
            onChange={handleSliderChange}
            style={{
              width: '100%',
              height: 8,
              borderRadius: 4,
              background: `linear-gradient(to right, #e74c3c 0%, #e74c3c ${((selectedAmount - minPayment) / (maxPayment - minPayment || 1)) * 100}%, #444 ${((selectedAmount - minPayment) / (maxPayment - minPayment || 1)) * 100}%, #444 100%)`,
              appearance: 'none',
              cursor: 'pointer',
            }}
          />
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            fontSize: 12, 
            color: '#888',
            marginTop: 4,
          }}>
            <span>{minPayment}</span>
            <span>{maxPayment}</span>
          </div>
        </div>

        {/* Quick select buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[1, 2, 3, 5, 10].filter(n => n >= minPayment && n <= maxPayment).map(amount => (
            <button
              key={amount}
              onClick={() => setSelectedAmount(amount)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: selectedAmount === amount ? '#e74c3c' : '#333',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: selectedAmount === amount ? 600 : 400,
              }}
            >
              {amount}
            </button>
          ))}
          {maxPayment > 10 && (
            <button
              onClick={() => setSelectedAmount(maxPayment)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: selectedAmount === maxPayment ? '#e74c3c' : '#333',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: selectedAmount === maxPayment ? 600 : 400,
              }}
            >
              Max ({maxPayment})
            </button>
          )}
        </div>

        {/* Warning for low life */}
        {lifeAfterPayment <= 0 && (
          <div style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(231, 76, 60, 0.2)',
            borderRadius: 6,
            border: '1px solid rgba(231, 76, 60, 0.5)',
            fontSize: 13,
            color: '#e74c3c',
            textAlign: 'center',
          }}>
            ⚠️ This will reduce your life to {lifeAfterPayment}. You will lose the game!
          </div>
        )}

        {/* Buttons */}
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
            disabled={!canConfirm}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: canConfirm ? '#e74c3c' : '#444',
              color: '#fff',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Pay {selectedAmount} Life
          </button>
        </div>
      </div>
    </div>
  );
}
