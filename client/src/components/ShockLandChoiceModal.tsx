/**
 * ShockLandChoiceModal.tsx
 * 
 * A modal for choosing whether to pay 2 life to have a shock land
 * enter the battlefield untapped, or let it enter tapped.
 * 
 * Used for: Stomping Ground, Breeding Pool, Hallowed Fountain, etc.
 */

import React from 'react';

export interface ShockLandChoiceModalProps {
  open: boolean;
  cardName: string;
  cardImageUrl?: string;
  onPayLife: () => void; // Enter untapped, pay 2 life
  onEnterTapped: () => void; // Enter tapped, don't pay life
  currentLife?: number;
}

export function ShockLandChoiceModal({
  open,
  cardName,
  cardImageUrl,
  onPayLife,
  onEnterTapped,
  currentLife,
}: ShockLandChoiceModalProps) {
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
          {currentLife !== undefined && (
            <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>
              Your life total: {currentLife}
            </div>
          )}
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
          "As {cardName} enters the battlefield, you may pay 2 life. If you don't, it enters the battlefield tapped."
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
            onClick={onPayLife}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#ef4444',
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
            <span>Pay 2 Life</span>
            <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
              Enter Untapped
            </span>
          </button>
          <button
            onClick={onEnterTapped}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
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
            <span>Don't Pay</span>
            <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
              Enter Tapped
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShockLandChoiceModal;
