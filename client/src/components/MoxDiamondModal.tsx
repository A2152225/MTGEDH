/**
 * MoxDiamondModal.tsx
 * 
 * A modal for handling Mox Diamond's ETB replacement effect:
 * "If Mox Diamond would enter the battlefield, you may discard a land card instead.
 * If you do, put Mox Diamond onto the battlefield. If you don't, put it into its owner's graveyard."
 * 
 * The player must either:
 * 1. Discard a land card to have Mox Diamond enter the battlefield
 * 2. Choose not to discard, putting Mox Diamond into the graveyard
 */

import React, { useState } from 'react';

export interface MoxDiamondModalProps {
  open: boolean;
  cardImageUrl?: string;
  landCardsInHand: Array<{ id: string; name: string; imageUrl?: string }>;
  onDiscardLand: (landCardId: string) => void;
  onPutInGraveyard: () => void;
}

export function MoxDiamondModal({
  open,
  cardImageUrl,
  landCardsInHand,
  onDiscardLand,
  onPutInGraveyard,
}: MoxDiamondModalProps) {
  const [selectedLandId, setSelectedLandId] = useState<string | null>(null);

  if (!open) return null;

  const hasLandsToDiscard = landCardsInHand.length > 0;

  const handleConfirmDiscard = () => {
    if (selectedLandId) {
      onDiscardLand(selectedLandId);
      setSelectedLandId(null);
    }
  };

  const handlePutInGraveyard = () => {
    setSelectedLandId(null);
    onPutInGraveyard();
  };

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
          maxWidth: 500,
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
            Mox Diamond - Replacement Effect
          </h2>
        </div>

        {/* Card image (if available) */}
        {cardImageUrl && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={cardImageUrl}
              alt="Mox Diamond"
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
          "If Mox Diamond would enter the battlefield, you may discard a land card instead. If you do, put Mox Diamond onto the battlefield. If you don't, put it into its owner's graveyard."
        </div>

        {/* Land selection or message if no lands */}
        {hasLandsToDiscard ? (
          <>
            <div style={{ textAlign: 'center', fontSize: 14, marginBottom: 4 }}>
              Select a land card to discard:
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'center',
                maxHeight: 200,
                overflowY: 'auto',
                padding: 8,
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderRadius: 8,
              }}
            >
              {landCardsInHand.map((land) => (
                <div
                  key={land.id}
                  onClick={() => setSelectedLandId(land.id)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: selectedLandId === land.id 
                      ? '2px solid #10b981' 
                      : '2px solid #4a4a6a',
                    backgroundColor: selectedLandId === land.id 
                      ? 'rgba(16, 185, 129, 0.2)' 
                      : 'rgba(255,255,255,0.05)',
                    cursor: 'pointer',
                    fontSize: 13,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {land.name}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div
            style={{
              textAlign: 'center',
              fontSize: 14,
              color: '#f87171',
              padding: 16,
              backgroundColor: 'rgba(248, 113, 113, 0.1)',
              borderRadius: 8,
            }}
          >
            You have no land cards in hand to discard.
            <br />
            Mox Diamond must go to the graveyard.
          </div>
        )}

        {/* Choice buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          {hasLandsToDiscard && (
            <button
              onClick={handleConfirmDiscard}
              disabled={!selectedLandId}
              style={{
                padding: '12px 24px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: selectedLandId ? '#10b981' : '#4a4a6a',
                color: '#fff',
                cursor: selectedLandId ? 'pointer' : 'not-allowed',
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                minWidth: 140,
                opacity: selectedLandId ? 1 : 0.6,
              }}
            >
              <span>Discard Land</span>
              <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
                Put Mox Diamond onto Battlefield
              </span>
            </button>
          )}
          <button
            onClick={handlePutInGraveyard}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
              backgroundColor: hasLandsToDiscard ? 'transparent' : '#ef4444',
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
            <span>Don't Discard</span>
            <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>
              Put Mox Diamond in Graveyard
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default MoxDiamondModal;
