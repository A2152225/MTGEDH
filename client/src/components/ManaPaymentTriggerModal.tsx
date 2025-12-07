/**
 * ManaPaymentTriggerModal.tsx
 * 
 * Modal for handling optional mana payment triggers during combat,
 * specifically for effects like Casal's "you may pay {1}{G}. If you do, transform her."
 * 
 * This is shown during declare attackers step when an attacking creature
 * has a trigger that allows optional mana payment.
 */

import React from 'react';

export interface ManaPaymentTriggerModalProps {
  open: boolean;
  cardName: string;
  cardImageUrl?: string;
  manaCost: string; // e.g., "{1}{G}"
  effect: string; // e.g., "Transform her"
  onPayMana: () => void; // Pay the mana and resolve the effect
  onDecline: () => void; // Don't pay, skip the effect
}

export function ManaPaymentTriggerModal({
  open,
  cardName,
  cardImageUrl,
  manaCost,
  effect,
  onPayMana,
  onDecline,
}: ManaPaymentTriggerModalProps) {
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
        zIndex: 10003, // Higher than triggered ability modal
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
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#10b981' }}>
            ⚡ Attack Trigger
          </h2>
        </div>

        {/* Card display */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {cardImageUrl && (
            <div style={{ flexShrink: 0 }}>
              <img
                src={cardImageUrl}
                alt={cardName}
                style={{
                  width: 140,
                  height: 'auto',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#fff' }}>
              {cardName}
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#aaa',
                padding: '10px 12px',
                backgroundColor: 'rgba(0,0,0,0.3)',
                borderRadius: 6,
                fontStyle: 'italic',
                lineHeight: 1.6,
              }}
            >
              Whenever {cardName} attacks, you may pay {manaCost}. If you do, {effect}.
            </div>
          </div>
        </div>

        {/* Payment info */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(16,185,129,0.1)',
            borderRadius: 8,
            border: '1px solid rgba(16,185,129,0.3)',
          }}
        >
          <div style={{ fontSize: 14, color: '#10b981', textAlign: 'center', fontWeight: 500 }}>
            Pay {manaCost} to {effect.toLowerCase()}?
          </div>
        </div>

        {/* Choice buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          <button
            onClick={onDecline}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #555',
              backgroundColor: 'transparent',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Don't Pay
          </button>
          <button
            onClick={onPayMana}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#10b981',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
            }}
          >
            Pay {manaCost}
          </button>
        </div>

        {/* Helper text */}
        <div style={{ fontSize: 11, color: '#666', textAlign: 'center', fontStyle: 'italic' }}>
          This payment must be made now, during the declare attackers step.
        </div>
      </div>
    </div>
  );
}

export default ManaPaymentTriggerModal;
