/**
 * JoinForcesModal.tsx
 * 
 * Modal for Join Forces cards (e.g., Minds Aglow, Collective Voyage).
 * Allows players to contribute mana to increase the effect.
 */

import React, { useState, useEffect } from 'react';

export interface JoinForcesRequest {
  id: string;
  gameId: string;
  initiator: string;
  initiatorName: string;
  cardName: string;
  effectDescription: string;
  cardImageUrl?: string;
  players: string[];
  timeoutMs: number;
}

export interface JoinForcesUpdate {
  id: string;
  gameId: string;
  playerId: string;
  playerName: string;
  contribution: number;
  responded: string[];
  contributions: Record<string, number>;
  totalContributions: number;
}

export interface JoinForcesModalProps {
  open: boolean;
  request: JoinForcesRequest | null;
  currentPlayerId: string;
  playerNames: Record<string, string>;
  availableMana: number; // How much mana the player can contribute
  contributions: Record<string, number>;
  responded: string[];
  onContribute: (amount: number) => void;
  onClose: () => void;
}

export function JoinForcesModal({
  open,
  request,
  currentPlayerId,
  playerNames,
  availableMana,
  contributions,
  responded,
  onContribute,
  onClose,
}: JoinForcesModalProps) {
  const [selectedAmount, setSelectedAmount] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(60);

  // Timer countdown
  useEffect(() => {
    if (!open || !request) return;
    
    const startTime = Date.now();
    const endTime = startTime + request.timeoutMs;
    
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [open, request]);

  // Reset selected amount when modal opens
  useEffect(() => {
    if (open) {
      setSelectedAmount(0);
    }
  }, [open]);

  if (!open || !request) return null;

  const hasResponded = responded.includes(currentPlayerId);
  const totalContributions = Object.values(contributions).reduce((sum, n) => sum + n, 0);
  const isInitiator = request.initiator === currentPlayerId;

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
        border: '2px solid #4a4a6a',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>🤝</span>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>Join Forces</h2>
            <div style={{ color: '#a0a0c0', fontSize: 14 }}>{request.cardName}</div>
          </div>
          <div style={{ 
            marginLeft: 'auto', 
            backgroundColor: timeRemaining < 10 ? '#ef4444' : '#3b82f6',
            padding: '4px 10px',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
          }}>
            {timeRemaining}s
          </div>
        </div>

        {/* Card Image (if available) */}
        {request.cardImageUrl && (
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <img 
              src={request.cardImageUrl} 
              alt={request.cardName}
              style={{ maxWidth: 200, borderRadius: 8 }}
            />
          </div>
        )}

        {/* Effect Description */}
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.05)',
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
          color: '#d0d0e0',
          fontSize: 14,
          lineHeight: 1.5,
        }}>
          <strong>{request.initiatorName}</strong> cast {request.cardName}.
          <br /><br />
          {request.effectDescription}
        </div>

        {/* Contributions Display */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#a0a0c0', fontSize: 12, marginBottom: 8 }}>
            Player Contributions:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {request.players.map(pid => {
              const name = playerNames[pid] || pid;
              const contrib = contributions[pid] || 0;
              const hasResponded = responded.includes(pid);
              
              return (
                <div key={pid} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  backgroundColor: hasResponded ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
                  borderRadius: 6,
                  border: `1px solid ${hasResponded ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
                }}>
                  <span style={{ color: '#d0d0e0', fontSize: 14 }}>
                    {name}
                    {pid === currentPlayerId && ' (you)'}
                    {pid === request.initiator && ' ⭐'}
                  </span>
                  <span style={{ 
                    color: hasResponded ? '#22c55e' : '#808090',
                    fontWeight: 600,
                    fontSize: 14,
                  }}>
                    {hasResponded ? `${contrib} mana` : 'waiting...'}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{
            marginTop: 12,
            padding: '8px 12px',
            backgroundColor: 'rgba(139,92,246,0.2)',
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ color: '#a78bfa', fontWeight: 600 }}>Total Contributions:</span>
            <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{totalContributions}</span>
          </div>
        </div>

        {/* Contribution Input (if not yet responded) */}
        {!hasResponded && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#a0a0c0', fontSize: 12, marginBottom: 8 }}>
              Your Contribution (available: {availableMana} mana):
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range"
                min={0}
                max={availableMana}
                value={selectedAmount}
                onChange={(e) => setSelectedAmount(parseInt(e.target.value, 10))}
                style={{ flex: 1 }}
              />
              <span style={{ 
                color: '#fff', 
                fontSize: 18, 
                fontWeight: 600,
                minWidth: 40,
                textAlign: 'right',
              }}>
                {selectedAmount}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSelectedAmount(0)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: selectedAmount === 0 ? '#8b5cf6' : '#374151',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                0
              </button>
              {[1, 2, 3, 5, 8, 10].filter(n => n <= availableMana).map(n => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setSelectedAmount(n)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: selectedAmount === n ? '#8b5cf6' : '#374151',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedAmount(availableMana)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: selectedAmount === availableMana ? '#8b5cf6' : '#374151',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Max ({availableMana})
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
          {!hasResponded ? (
            <button
              type="button"
              onClick={() => onContribute(selectedAmount)}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: '#8b5cf6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#7c3aed'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#8b5cf6'}
            >
              Contribute {selectedAmount} Mana
            </button>
          ) : (
            <div style={{
              flex: 1,
              padding: '12px 20px',
              backgroundColor: 'rgba(34,197,94,0.2)',
              color: '#22c55e',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              textAlign: 'center',
            }}>
              ✓ You contributed {contributions[currentPlayerId] || 0} mana
            </div>
          )}
          {/* Show waiting message when player has responded but others haven't */}
          {hasResponded && responded.length < request.players.length && (
            <div style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(59,130,246,0.1)',
              color: '#60a5fa',
              borderRadius: 6,
              fontSize: 13,
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>⏳</span>
              Waiting for {request.players.length - responded.length} other player(s)...
            </div>
          )}
          {/* Close button - only show after player has responded (as fallback if modal gets stuck) */}
          {hasResponded && (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: '#9ca3af',
                border: '1px solid #4b5563',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                marginTop: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#6b7280';
                e.currentTarget.style.color = '#d1d5db';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#4b5563';
                e.currentTarget.style.color = '#9ca3af';
              }}
            >
              Close (effect will still resolve)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default JoinForcesModal;
