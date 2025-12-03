/**
 * SpyNetworkModal.tsx
 * 
 * Modal for Spy Network and similar multi-part spy/reorder effects.
 * 
 * Spy Network (Onslaught):
 * "Look at target player's hand, the top card of that player's library, 
 *  and any face-down creatures they control."
 * "Look at the top four cards of your library, then put them back in any order."
 * 
 * This is a two-phase modal:
 * Phase 1: View target player's information (hand, top card, face-down creatures)
 * Phase 2: Reorder your own top 4 cards
 */

import React, { useMemo, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type PeekCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export interface SpyNetworkModalProps {
  /** Card name that triggered this effect (for display) */
  cardName: string;
  /** Optional card image URL */
  cardImageUrl?: string;
  /** Image preference for card display */
  imagePref: ImagePref;
  
  // Target player info (Phase 1)
  /** Target player ID */
  targetPlayerId: string;
  /** Target player name */
  targetPlayerName: string;
  /** Target player's hand */
  targetHand: PeekCard[];
  /** Target player's top card of library */
  targetTopCard: PeekCard | null;
  /** Target player's face-down creatures (revealed) */
  targetFaceDownCreatures: PeekCard[];
  
  // Your library reorder (Phase 2)
  /** Your top cards to reorder */
  yourTopCards: PeekCard[];
  
  /** Callback when player confirms */
  onConfirm: (payload: { 
    newLibraryOrder: string[];  // Your library cards in new order (top first)
  }) => void;
  /** Callback when modal is cancelled */
  onCancel: () => void;
}

export function SpyNetworkModal({
  cardName,
  cardImageUrl,
  imagePref,
  targetPlayerId,
  targetPlayerName,
  targetHand,
  targetTopCard,
  targetFaceDownCreatures,
  yourTopCards,
  onConfirm,
  onCancel,
}: SpyNetworkModalProps) {
  // Phase: 1 = viewing target, 2 = reordering own library
  const [phase, setPhase] = useState<1 | 2>(1);
  
  // Library reorder state
  const [libraryOrder, setLibraryOrder] = useState<string[]>(() => 
    yourTopCards.map(c => c.id)
  );
  
  const yourCardById = useMemo(() => new Map(yourTopCards.map(c => [c.id, c])), [yourTopCards]);
  
  // Move card up or down in the library order
  const moveCard = (id: string, direction: -1 | 1) => {
    setLibraryOrder(prev => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };
  
  const resetOrder = () => {
    setLibraryOrder(yourTopCards.map(c => c.id));
  };
  
  const handleConfirm = () => {
    onConfirm({
      newLibraryOrder: libraryOrder,
    });
  };
  
  const CardDisplay = ({ card, label }: { card: PeekCard; label?: string }) => {
    const img = card.image_uris?.[imagePref] || card.image_uris?.normal || card.image_uris?.small;
    
    return (
      <div
        onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card as any, { prefer: 'above', anchorPadding: 0 })}
        onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
        style={{ 
          position: 'relative', 
          border: '1px solid #333', 
          borderRadius: 8, 
          background: '#1a1a2e', 
          height: 160, 
          overflow: 'hidden',
        }}
        title={card.name}
      >
        {label && (
          <div style={{
            position: 'absolute',
            top: 4,
            left: 4,
            background: '#4b5563',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
            zIndex: 10,
          }}>
            {label}
          </div>
        )}
        
        {img ? (
          <img 
            src={img} 
            alt={card.name} 
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} 
          />
        ) : (
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: '#eee', 
            fontSize: 11,
            padding: 8,
            textAlign: 'center',
          }}>
            {card.name}
          </div>
        )}
      </div>
    );
  };
  
  const ReorderableCard = ({ id, index }: { id: string; index: number }) => {
    const card = yourCardById.get(id);
    if (!card) return null;
    
    const img = card.image_uris?.[imagePref] || card.image_uris?.normal || card.image_uris?.small;
    const isTop = index === 0;
    
    return (
      <div
        onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card as any, { prefer: 'above', anchorPadding: 0 })}
        onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
        style={{ 
          position: 'relative', 
          border: isTop ? '2px solid #22c55e' : '1px solid #333', 
          borderRadius: 8, 
          background: '#1a1a2e', 
          height: 180, 
          overflow: 'hidden',
          boxShadow: isTop ? '0 0 10px rgba(34, 197, 94, 0.3)' : 'none',
        }}
        title={card.name}
      >
        <div style={{
          position: 'absolute',
          top: 4,
          left: 4,
          background: isTop ? '#22c55e' : '#4b5563',
          color: '#fff',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          zIndex: 10,
        }}>
          #{index + 1}
        </div>
        
        {img ? (
          <img 
            src={img} 
            alt={card.name} 
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} 
          />
        ) : (
          <div style={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: '#eee', 
            fontSize: 12,
            padding: 8,
            textAlign: 'center',
          }}>
            {card.name}
          </div>
        )}
        
        <div style={{ 
          position: 'absolute', 
          bottom: 6, 
          right: 6, 
          display: 'flex', 
          gap: 4,
        }}>
          <button 
            onClick={() => moveCard(id, -1)}
            disabled={index === 0}
            style={{
              padding: '4px 8px',
              background: index === 0 ? '#374151' : '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: index === 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: index === 0 ? 0.5 : 1,
            }}
            title="Move up"
          >
            ↑
          </button>
          <button 
            onClick={() => moveCard(id, 1)}
            disabled={index === libraryOrder.length - 1}
            style={{
              padding: '4px 8px',
              background: index === libraryOrder.length - 1 ? '#374151' : '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: index === libraryOrder.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: index === libraryOrder.length - 1 ? 0.5 : 1,
            }}
            title="Move down"
          >
            ↓
          </button>
        </div>
      </div>
    );
  };
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.75)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a2e',
        borderRadius: 12,
        width: 900,
        maxWidth: '95vw',
        padding: 20,
        border: '2px solid #4a4a6a',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>🕵️</span>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>
              {cardName}
              <span style={{ 
                marginLeft: 12, 
                fontSize: 14, 
                color: phase === 1 ? '#ef4444' : '#22c55e',
                background: phase === 1 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                padding: '2px 10px',
                borderRadius: 4,
              }}>
                {phase === 1 ? `Phase 1: Spy on ${targetPlayerName}` : 'Phase 2: Reorder Your Library'}
              </span>
            </h2>
            <div style={{ color: '#a0a0c0', fontSize: 13 }}>
              {phase === 1 
                ? `View ${targetPlayerName}'s hand, top card, and face-down creatures` 
                : 'Put your top cards back in any order'}
            </div>
          </div>
          {phase === 2 && (
            <button
              onClick={resetOrder}
              style={{
                padding: '6px 12px',
                background: '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Reset
            </button>
          )}
        </div>
        
        {/* Phase 1: Spy on target */}
        {phase === 1 && (
          <>
            {/* Target's Hand */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ 
                color: '#ef4444', 
                fontSize: 13, 
                marginBottom: 8,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                ✋ {targetPlayerName}'s Hand ({targetHand.length} cards):
              </div>
              {targetHand.length > 0 ? (
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: `repeat(${Math.min(targetHand.length, 5)}, 1fr)`,
                  gap: 10,
                }}>
                  {targetHand.map((card, i) => (
                    <CardDisplay key={card.id} card={card} label={`${i + 1}`} />
                  ))}
                </div>
              ) : (
                <div style={{ 
                  color: '#6b7280', 
                  fontSize: 13, 
                  padding: 20, 
                  textAlign: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 8,
                }}>
                  {targetPlayerName}'s hand is empty
                </div>
              )}
            </div>
            
            {/* Target's Top Card */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ 
                color: '#f59e0b', 
                fontSize: 13, 
                marginBottom: 8,
                fontWeight: 600,
              }}>
                📚 Top Card of {targetPlayerName}'s Library:
              </div>
              {targetTopCard ? (
                <div style={{ width: 140 }}>
                  <CardDisplay card={targetTopCard} label="Top" />
                </div>
              ) : (
                <div style={{ 
                  color: '#6b7280', 
                  fontSize: 13, 
                  padding: 20, 
                  textAlign: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 8,
                }}>
                  Library is empty
                </div>
              )}
            </div>
            
            {/* Target's Face-down Creatures */}
            {targetFaceDownCreatures.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ 
                  color: '#8b5cf6', 
                  fontSize: 13, 
                  marginBottom: 8,
                  fontWeight: 600,
                }}>
                  🎭 {targetPlayerName}'s Face-down Creatures (Revealed):
                </div>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: `repeat(${Math.min(targetFaceDownCreatures.length, 4)}, 1fr)`,
                  gap: 10,
                }}>
                  {targetFaceDownCreatures.map((card) => (
                    <CardDisplay key={card.id} card={card} label="Face-down" />
                  ))}
                </div>
              </div>
            )}
            
            {/* Proceed button */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'flex-end', 
              gap: 12,
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}>
              <button
                onClick={onCancel}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  color: '#9ca3af',
                  border: '1px solid #4b5563',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setPhase(2)}
                style={{
                  padding: '10px 24px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Continue to Reorder Your Library →
              </button>
            </div>
          </>
        )}
        
        {/* Phase 2: Reorder own library */}
        {phase === 2 && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ 
                color: '#22c55e', 
                fontSize: 13, 
                marginBottom: 8,
                fontWeight: 600,
              }}>
                📚 Your Top {yourTopCards.length} Cards (left = top of library):
              </div>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: `repeat(${Math.min(libraryOrder.length, 4)}, 1fr)`,
                gap: 12,
              }}>
                {libraryOrder.map((id, index) => (
                  <ReorderableCard key={id} id={id} index={index} />
                ))}
              </div>
            </div>
            
            {/* Summary */}
            <div style={{
              background: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              color: '#c4b5fd',
              fontSize: 13,
            }}>
              <strong>Effect:</strong> Put cards back on top of your library in the order shown
              {libraryOrder.length > 0 && (
                <> (top card: <strong style={{ color: '#22c55e' }}>{yourCardById.get(libraryOrder[0])?.name}</strong>)</>
              )}
            </div>
            
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPhase(1)}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  color: '#9ca3af',
                  border: '1px solid #4b5563',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                ← Back to Spy Phase
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  padding: '10px 24px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Confirm
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SpyNetworkModal;
