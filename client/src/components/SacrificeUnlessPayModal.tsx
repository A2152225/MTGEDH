/**
 * SacrificeUnlessPayModal.tsx
 * 
 * A modal for choosing whether to pay mana to keep a permanent
 * or sacrifice it because you can't/won't pay.
 * 
 * Used for: Transguild Promenade, Gateway Plaza, Rupture Spire, etc.
 */

import React from 'react';

export interface SacrificeUnlessPayModalProps {
  open: boolean;
  cardName: string;
  cardImageUrl?: string;
  manaCost: string; // e.g., "{1}"
  onPayMana: () => void; // Keep the permanent, pay the cost
  onSacrifice: () => void; // Sacrifice the permanent
}

export function SacrificeUnlessPayModal({
  open,
  cardName,
  cardImageUrl,
  manaCost,
  onPayMana,
  onSacrifice,
}: SacrificeUnlessPayModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
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
          maxWidth: 400,
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
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {cardName} Enters the Battlefield
          </h2>
        </div>

        {/* Card image (if available) */}
        {cardImageUrl && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={cardImageUrl}
              alt={cardName}
              style={{
                width: 180,
                height: 'auto',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            />
          </div>
        )}

        {/* Oracle text explanation */}
        <div
          style={{
            fontSize: 13,
            color: '#aaa',
            textAlign: 'center',
            fontStyle: 'italic',
            padding: '8px 16px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: 6,
          }}
        >
          "When {cardName} enters the battlefield, sacrifice it unless you pay {manaCost}."
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
            onClick={onPayMana}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#10b981',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              minWidth: 140,
            }}
          >
            <span>Pay {manaCost}</span>
            <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
              Keep {cardName}
            </span>
          </button>
          <button
            onClick={onSacrifice}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              minWidth: 140,
            }}
          >
            <span>Don't Pay</span>
            <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
              Sacrifice It
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default SacrificeUnlessPayModal;
