/**
 * TemptingOfferModal.tsx
 * 
 * Modal for Tempting Offer cards (e.g., Tempt with Discovery, Tempt with Vengeance).
 * Opponents can choose to accept (get the effect but give the caster bonus) or decline.
 */

import React, { useState, useEffect } from 'react';

export interface TemptingOfferRequest {
  id: string;
  gameId: string;
  initiator: string;
  initiatorName: string;
  cardName: string;
  effectDescription: string;
  cardImageUrl?: string;
  opponents: string[];
  timeoutMs: number;
}

export interface TemptingOfferUpdate {
  id: string;
  gameId: string;
  playerId: string;
  playerName: string;
  accepted: boolean;
  responded: string[];
  acceptedBy: string[];
}

export interface TemptingOfferModalProps {
  open: boolean;
  request: TemptingOfferRequest | null;
  currentPlayerId: string;
  playerNames: Record<string, string>;
  responded: string[];
  acceptedBy: string[];
  onRespond: (accept: boolean) => void;
  onClose: () => void;
}

export function TemptingOfferModal({
  open,
  request,
  currentPlayerId,
  playerNames,
  responded,
  acceptedBy,
  onRespond,
  onClose,
}: TemptingOfferModalProps) {
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

  if (!open || !request) return null;

  const isOpponent = request.opponents.includes(currentPlayerId);
  const hasResponded = responded.includes(currentPlayerId);
  const hasAccepted = acceptedBy.includes(currentPlayerId);
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
        border: '2px solid #f59e0b',
        boxShadow: '0 8px 32px rgba(245,158,11,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>🎁</span>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>Tempting Offer</h2>
            <div style={{ color: '#fbbf24', fontSize: 14 }}>{request.cardName}</div>
          </div>
          <div style={{ 
            marginLeft: 'auto', 
            backgroundColor: timeRemaining < 10 ? '#ef4444' : '#f59e0b',
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
          backgroundColor: 'rgba(245,158,11,0.1)',
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
          color: '#d0d0e0',
          fontSize: 14,
          lineHeight: 1.5,
          border: '1px solid rgba(245,158,11,0.3)',
        }}>
          <strong>{request.initiatorName}</strong> cast {request.cardName}.
          <br /><br />
          <strong>The Offer:</strong> {request.effectDescription}
          <br /><br />
          <em style={{ color: '#fbbf24' }}>
            If you accept, you get the effect too - but {request.initiatorName} gets an additional copy of the effect!
          </em>
        </div>

        {/* Responses Display */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#a0a0c0', fontSize: 12, marginBottom: 8 }}>
            Opponent Responses:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {request.opponents.map(pid => {
              const name = playerNames[pid] || pid;
              const hasResponded = responded.includes(pid);
              const hasAccepted = acceptedBy.includes(pid);
              
              return (
                <div key={pid} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  backgroundColor: hasResponded 
                    ? (hasAccepted ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)')
                    : 'rgba(255,255,255,0.03)',
                  borderRadius: 6,
                  border: `1px solid ${
                    hasResponded 
                      ? (hasAccepted ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)')
                      : 'rgba(255,255,255,0.1)'
                  }`,
                }}>
                  <span style={{ color: '#d0d0e0', fontSize: 14 }}>
                    {name}
                    {pid === currentPlayerId && ' (you)'}
                  </span>
                  <span style={{ 
                    color: hasResponded 
                      ? (hasAccepted ? '#22c55e' : '#ef4444')
                      : '#808090',
                    fontWeight: 600,
                    fontSize: 14,
                  }}>
                    {hasResponded 
                      ? (hasAccepted ? '✓ Accepted' : '✗ Declined')
                      : 'waiting...'}
                  </span>
                </div>
              );
            })}
          </div>
          
          {/* Summary */}
          <div style={{
            marginTop: 12,
            padding: '8px 12px',
            backgroundColor: 'rgba(245,158,11,0.2)',
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ color: '#fbbf24', fontWeight: 600 }}>
              {request.initiatorName} will get the effect:
            </span>
            <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>
              {1 + acceptedBy.length}× 
            </span>
          </div>
        </div>

        {/* Action Buttons (for opponents who haven't responded) */}
        {isOpponent && !hasResponded && (
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => onRespond(true)}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              ✓ Accept Offer
            </button>
            <button
              onClick={() => onRespond(false)}
              style={{
                flex: 1,
                padding: '12px 20px',
                backgroundColor: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              ✗ Decline
            </button>
          </div>
        )}
        
        {/* Status for initiator or already responded */}
        {(isInitiator || hasResponded) && (
          <div style={{
            padding: '12px 20px',
            backgroundColor: isInitiator 
              ? 'rgba(245,158,11,0.2)' 
              : (hasAccepted ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'),
            color: isInitiator ? '#fbbf24' : (hasAccepted ? '#22c55e' : '#ef4444'),
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            textAlign: 'center',
          }}>
            {isInitiator 
              ? `Waiting for opponents to respond... (${responded.length}/${request.opponents.length})`
              : (hasAccepted ? '✓ You accepted the offer' : '✗ You declined the offer')}
          </div>
        )}
      </div>
    </div>
  );
}

export default TemptingOfferModal;
