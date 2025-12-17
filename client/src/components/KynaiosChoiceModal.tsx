/**
 * KynaiosChoiceModal.tsx
 * 
 * Modal for Kynaios and Tiro of Meletis style effects.
 * "At the beginning of your end step, draw a card. Each player may put a land 
 * card from their hand onto the battlefield, then each opponent who didn't 
 * draws a card."
 * 
 * This allows players to:
 * - Put a land from their hand onto the battlefield
 * - OR (for opponents) draw a card instead
 * - OR decline (controller only - they already drew)
 */

import React, { useState } from 'react';

export interface KynaiosChoiceRequest {
  gameId: string;
  sourceController: string;
  sourceName: string;
  isController: boolean;  // Whether this player is the source controller
  canPlayLand: boolean;   // Whether this player has lands in hand
  landsInHand: Array<{ id: string; name: string; imageUrl?: string }>;
  options: Array<'play_land' | 'draw_card' | 'decline'>;
  stepId?: string;  // Resolution step ID when using the unified queue system
}

export interface KynaiosChoiceModalProps {
  open: boolean;
  request: KynaiosChoiceRequest | null;
  controllerName: string;
  onRespond: (choice: 'play_land' | 'draw_card' | 'decline', landCardId?: string) => void;
}

export function KynaiosChoiceModal({
  open,
  request,
  controllerName,
  onRespond,
}: KynaiosChoiceModalProps) {
  const [selectedLandId, setSelectedLandId] = useState<string | null>(null);

  if (!open || !request) return null;

  const { sourceName, isController, canPlayLand, landsInHand, options } = request;

  // Handler for playing a land
  const handlePlayLand = () => {
    if (selectedLandId) {
      onRespond('play_land', selectedLandId);
    }
  };

  // Handler for drawing a card (opponent only)
  const handleDrawCard = () => {
    onRespond('draw_card');
  };

  // Handler for declining (controller only)
  const handleDecline = () => {
    onRespond('decline');
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        padding: 24,
        maxWidth: 500,
        width: '90%',
        border: '2px solid #22c55e',
        boxShadow: '0 8px 32px rgba(34,197,94,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>🌿</span>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>{sourceName}</h2>
            <div style={{ color: '#4ade80', fontSize: 14 }}>
              {isController ? 'Your ability triggered' : `${controllerName}'s ability`}
            </div>
          </div>
        </div>

        {/* Effect Description */}
        <div style={{
          backgroundColor: 'rgba(34,197,94,0.1)',
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
          color: '#d0d0e0',
          fontSize: 14,
          lineHeight: 1.5,
          border: '1px solid rgba(34,197,94,0.3)',
        }}>
          {isController ? (
            <>
              <strong>You drew a card!</strong>
              <br /><br />
              Now you may put a land card from your hand onto the battlefield.
              <br /><br />
              <em style={{ color: '#4ade80' }}>
                Each opponent who doesn't play a land will draw a card.
              </em>
            </>
          ) : (
            <>
              <strong>{controllerName}'s {sourceName}</strong> triggered!
              <br /><br />
              You may put a land card from your hand onto the battlefield.
              <br />
              <strong>If you don't, you draw a card.</strong>
              <br /><br />
              <em style={{ color: '#4ade80' }}>
                Choose wisely: land now vs card advantage later.
              </em>
            </>
          )}
        </div>

        {/* Land Selection (if player has lands) */}
        {canPlayLand && landsInHand.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#a0a0c0', fontSize: 12, marginBottom: 8 }}>
              Select a land to play:
            </div>
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: 8,
              maxHeight: 200,
              overflowY: 'auto',
            }}>
              {landsInHand.map(land => (
                <div
                  key={land.id}
                  onClick={() => setSelectedLandId(land.id)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: selectedLandId === land.id 
                      ? 'rgba(34,197,94,0.3)' 
                      : 'rgba(255,255,255,0.05)',
                    border: selectedLandId === land.id 
                      ? '2px solid #22c55e' 
                      : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: '#d0d0e0',
                    fontSize: 14,
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {land.imageUrl && (
                    <img 
                      src={land.imageUrl} 
                      alt={land.name}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      style={{ 
                        width: 40, 
                        height: 56, 
                        borderRadius: 4,
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <span>{land.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No lands message */}
        {!canPlayLand && (
          <div style={{
            marginBottom: 16,
            padding: '12px',
            backgroundColor: 'rgba(239,68,68,0.1)',
            borderRadius: 8,
            color: '#f87171',
            fontSize: 14,
            border: '1px solid rgba(239,68,68,0.3)',
          }}>
            You have no lands in your hand to play.
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
          {/* Play Land button (if lands available) */}
          {canPlayLand && options.includes('play_land') && (
            <button
              onClick={handlePlayLand}
              disabled={!selectedLandId}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: selectedLandId ? '#22c55e' : '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: selectedLandId ? 'pointer' : 'not-allowed',
                fontSize: 15,
                fontWeight: 600,
                opacity: selectedLandId ? 1 : 0.5,
              }}
            >
              🏞️ {selectedLandId ? `Play ${landsInHand.find(l => l.id === selectedLandId)?.name || 'Land'}` : 'Select a Land to Play'}
            </button>
          )}

          {/* Draw Card button (opponents only) */}
          {!isController && options.includes('draw_card') && (
            <button
              onClick={handleDrawCard}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              📚 Draw a Card Instead
            </button>
          )}

          {/* Decline button (controller only) */}
          {isController && options.includes('decline') && (
            <button
              onClick={handleDecline}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              ⏭️ Skip (Don't Play a Land)
            </button>
          )}

          {/* For opponents with no lands - automatic draw message */}
          {!isController && !canPlayLand && (
            <button
              onClick={handleDrawCard}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              📚 Draw a Card (No Lands Available)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default KynaiosChoiceModal;
