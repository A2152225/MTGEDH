/**
 * PonderModal.tsx
 * 
 * Modal for Ponder-style library manipulation effects:
 * "Look at the top N cards of your library, then put them back in any order"
 * 
 * Supports multiple variants:
 * - Ponder: Look at top 3, put back in any order, may shuffle, then draw
 * - Index: Look at top 5, put back in any order (no shuffle, no draw)
 * - Sage Owl/Sage of Epityr: ETB look at top 4, put back in any order
 * - Mystic Speculation: Look at top 3, put back in any order (buyback)
 * - Telling Time: Look at top 3, put 1 in hand, rest back in any order
 * - Soothsaying: Look at top X, put back in any order
 * - Architects of Will: Look at top 3 of TARGET PLAYER's library, put back in any order
 * 
 * Pattern recognition for "back in any order" cards (29+ cards in MTG)
 * 
 * Supports targeting both your own library and opponents' libraries
 */

import React, { useMemo, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type PeekCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

/**
 * Variant types for different library manipulation effects
 */
export type PonderVariant = 
  | 'ponder'           // Look, reorder, may shuffle, draw 1
  | 'index'            // Look, reorder only (no shuffle, no draw)
  | 'telling_time'     // Look, pick 1 to hand, reorder rest on top
  | 'brainstorm'       // Already drew 3, put 2 back on top in order
  | 'architects';      // Look at target player's library, reorder (no shuffle, no draw)

export interface PonderModalProps {
  /** Cards shown (top to bottom of library) */
  cards: PeekCard[];
  /** Card name that triggered this effect (for display) */
  cardName: string;
  /** Optional card image URL */
  cardImageUrl?: string;
  /** Image preference for card display */
  imagePref: ImagePref;
  /** The variant of library manipulation effect */
  variant?: PonderVariant;
  /** Whether shuffle option is available (Ponder has it, Index doesn't) */
  canShuffle?: boolean;
  /** Whether to draw after reordering (Ponder draws, Index doesn't) */
  drawAfter?: boolean;
  /** Number of cards to pick to hand (Telling Time = 1, Brainstorm = 0) */
  pickToHand?: number;
  /** Target player ID (whose library is being manipulated) */
  targetPlayerId?: string;
  /** Target player name (for display) */
  targetPlayerName?: string;
  /** Whether this is the current player's own library */
  isOwnLibrary?: boolean;
  /** Callback when player confirms their choice */
  onConfirm: (payload: { 
    newOrder: string[];     // Card IDs in new order (top first) - cards staying on library
    shouldShuffle: boolean;
    toHand?: string[];      // Card IDs going to hand (for Telling Time style)
  }) => void;
  /** Callback when modal is cancelled */
  onCancel: () => void;
}

export function PonderModal({
  cards,
  cardName,
  cardImageUrl,
  imagePref,
  variant = 'ponder',
  canShuffle = false,
  drawAfter = false,
  pickToHand = 0,
  targetPlayerId,
  targetPlayerName,
  isOwnLibrary = true,
  onConfirm,
  onCancel,
}: PonderModalProps) {
  // State: ordered list of card IDs on library (top first)
  const [libraryOrder, setLibraryOrder] = useState<string[]>(() => 
    pickToHand > 0 ? [] : cards.map(c => c.id)
  );
  // State: cards going to hand (for Telling Time style)
  const [handCards, setHandCards] = useState<string[]>(() => 
    pickToHand > 0 ? cards.map(c => c.id) : []
  );
  const [willShuffle, setWillShuffle] = useState(false);
  
  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  
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
  
  // For Telling Time style: move card between hand selection and library
  const moveToHand = (id: string) => {
    if (handCards.length >= pickToHand) return; // Can't pick more
    setLibraryOrder(prev => prev.filter(x => x !== id));
    setHandCards(prev => [...prev, id]);
  };
  
  const moveToLibrary = (id: string) => {
    setHandCards(prev => prev.filter(x => x !== id));
    setLibraryOrder(prev => [...prev, id]);
  };
  
  // Reset to original order
  const resetOrder = () => {
    if (pickToHand > 0) {
      setLibraryOrder([]);
      setHandCards(cards.map(c => c.id));
    } else {
      setLibraryOrder(cards.map(c => c.id));
      setHandCards([]);
    }
    setWillShuffle(false);
  };
  
  const handleConfirm = () => {
    onConfirm({
      newOrder: libraryOrder,
      shouldShuffle: willShuffle,
      toHand: handCards.length > 0 ? handCards : undefined,
    });
  };
  
  // Validation
  const isValid = pickToHand > 0 
    ? handCards.length === pickToHand && libraryOrder.length === cards.length - pickToHand
    : libraryOrder.length === cards.length;
  
  const CardBox = ({ id, index, inHand = false }: { id: string; index: number; inHand?: boolean }) => {
    const c = cardById.get(id);
    if (!c) return null;
    
    const img = c.image_uris?.[imagePref] || c.image_uris?.normal || c.image_uris?.small;
    const isTop = !inHand && index === 0;
    const showDrawIndicator = !inHand && index === 0 && drawAfter && !willShuffle && isOwnLibrary;
    
    return (
      <div
        onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, c as any, { prefer: 'above', anchorPadding: 0 })}
        onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
        style={{ 
          position: 'relative', 
          border: inHand ? '2px solid #3b82f6' : (isTop ? '2px solid #22c55e' : '1px solid #333'), 
          borderRadius: 8, 
          background: '#1a1a2e', 
          height: 180, 
          overflow: 'hidden',
          boxShadow: inHand ? '0 0 10px rgba(59, 130, 246, 0.3)' : (isTop ? '0 0 10px rgba(34, 197, 94, 0.3)' : 'none'),
        }}
        title={c.name}
      >
        {/* Position indicator */}
        <div style={{
          position: 'absolute',
          top: 4,
          left: 4,
          background: inHand ? '#3b82f6' : (showDrawIndicator ? '#22c55e' : '#4b5563'),
          color: '#fff',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          zIndex: 10,
        }}>
          {inHand ? '✋ Hand' : (showDrawIndicator ? '📖 Draw' : `#${index + 1}`)}
        </div>
        
        {img ? (
          <img 
            src={img} 
            alt={c.name} 
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
            {c.name}
          </div>
        )}
        
        {/* Action buttons */}
        <div style={{ 
          position: 'absolute', 
          bottom: 6, 
          right: 6, 
          display: 'flex', 
          gap: 4,
        }}>
          {inHand ? (
            <button 
              onClick={() => moveToLibrary(id)}
              style={{
                padding: '4px 8px',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="Put on library"
            >
              → Library
            </button>
          ) : pickToHand > 0 && handCards.length < pickToHand ? (
            <button 
              onClick={() => moveToHand(id)}
              style={{
                padding: '4px 8px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="Put in hand"
            >
              ← Hand
            </button>
          ) : null}
          
          {!inHand && libraryOrder.length > 1 && (
            <>
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
                title="Move up (closer to top)"
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
                title="Move down (away from top)"
              >
                ↓
              </button>
            </>
          )}
        </div>
      </div>
    );
  };
  
  // Get description based on variant and target
  const getDescription = () => {
    const targetText = isOwnLibrary ? 'your' : `${targetPlayerName || 'target player'}'s`;
    
    switch (variant) {
      case 'ponder':
        return `Look at these cards from ${targetText} library, reorder them, then choose to keep this order or shuffle`;
      case 'index':
        return `Look at these cards from ${targetText} library and put them back in any order`;
      case 'telling_time':
        return `Choose ${pickToHand} card${pickToHand > 1 ? 's' : ''} to put in your hand, then order the rest on top of ${targetText} library`;
      case 'brainstorm':
        return `Put these cards on top of ${targetText} library in any order`;
      case 'architects':
        return `Reorder the top cards of ${targetText} library`;
      default:
        return `Reorder these cards from ${targetText} library`;
    }
  };
  
  // Get header icon based on whether it's own library or opponent's
  const getHeaderIcon = () => {
    if (!isOwnLibrary) return '🎯'; // Target icon for opponent's library
    switch (variant) {
      case 'ponder': return '🔮';
      case 'telling_time': return '⏰';
      case 'brainstorm': return '🧠';
      default: return '📚';
    }
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
        width: 800,
        maxWidth: '95vw',
        padding: 20,
        border: `2px solid ${isOwnLibrary ? '#4a4a6a' : '#dc2626'}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>{getHeaderIcon()}</span>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>
              {cardName}
              {!isOwnLibrary && (
                <span style={{ 
                  marginLeft: 8, 
                  fontSize: 14, 
                  color: '#ef4444',
                  background: 'rgba(239, 68, 68, 0.1)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}>
                  Targeting {targetPlayerName || 'opponent'}
                </span>
              )}
            </h2>
            <div style={{ color: '#a0a0c0', fontSize: 13 }}>
              {getDescription()}
            </div>
          </div>
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
        </div>
        
        {/* Hand section (for Telling Time style - only if own library) */}
        {pickToHand > 0 && isOwnLibrary && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ 
              color: '#3b82f6', 
              fontSize: 13, 
              marginBottom: 8,
              fontWeight: 600,
            }}>
              ✋ Going to Hand ({handCards.length}/{pickToHand}):
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: `repeat(${Math.min(handCards.length || 1, 3)}, 1fr)`,
              gap: 12,
              minHeight: 60,
              background: 'rgba(59, 130, 246, 0.05)',
              border: '1px dashed rgba(59, 130, 246, 0.3)',
              borderRadius: 8,
              padding: handCards.length > 0 ? 12 : 20,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {handCards.length === 0 ? (
                <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
                  Click a card below to add it to your hand
                </div>
              ) : (
                handCards.map((id, index) => (
                  <CardBox key={id} id={id} index={index} inHand={true} />
                ))
              )}
            </div>
          </div>
        )}
        
        {/* Library section */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ 
            color: isOwnLibrary ? '#9ca3af' : '#f87171', 
            fontSize: 12, 
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span>
              📚 {isOwnLibrary ? 'Your' : `${targetPlayerName || "Opponent"}'s`} library order 
              (left = top of library{drawAfter && !willShuffle && isOwnLibrary ? ', will be drawn' : ''}):
            </span>
          </div>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: `repeat(${Math.min(libraryOrder.length || 1, 4)}, 1fr)`,
            gap: 12,
            minHeight: libraryOrder.length === 0 ? 60 : undefined,
            background: libraryOrder.length === 0 ? 'rgba(255,255,255,0.02)' : undefined,
            border: libraryOrder.length === 0 ? '1px dashed rgba(255,255,255,0.1)' : undefined,
            borderRadius: 8,
            padding: libraryOrder.length === 0 ? 20 : 0,
          }}>
            {libraryOrder.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
                {pickToHand > 0 ? 'Select cards for your hand first' : 'No cards'}
              </div>
            ) : (
              libraryOrder.map((id, index) => (
                <CardBox key={id} id={id} index={index} />
              ))
            )}
          </div>
        </div>
        
        {/* Shuffle option (only for own library) */}
        {canShuffle && isOwnLibrary && (
          <div style={{
            background: willShuffle ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${willShuffle ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              cursor: 'pointer',
              color: '#d0d0e0',
            }}>
              <input
                type="checkbox"
                checked={willShuffle}
                onChange={(e) => setWillShuffle(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  🔀 Shuffle library after reordering
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                  {willShuffle 
                    ? "Library will be shuffled - the order above won't matter"
                    : "Keep the order you set"
                  }
                </div>
              </div>
            </label>
          </div>
        )}
        
        {/* Summary */}
        <div style={{
          background: isOwnLibrary ? 'rgba(139, 92, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${isOwnLibrary ? 'rgba(139, 92, 246, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          color: isOwnLibrary ? '#c4b5fd' : '#fca5a5',
          fontSize: 13,
        }}>
          {!isOwnLibrary ? (
            <>
              <strong>Effect:</strong> Put cards back on top of {targetPlayerName || "opponent"}'s library in the order shown
              {libraryOrder.length > 0 && (
                <> (top card: <strong>{cardById.get(libraryOrder[0])?.name}</strong>)</>
              )}
            </>
          ) : pickToHand > 0 ? (
            <>
              <strong>Effect:</strong> Put{' '}
              {handCards.map((id, i) => (
                <span key={id}>
                  <strong style={{ color: '#3b82f6' }}>{cardById.get(id)?.name}</strong>
                  {i < handCards.length - 1 ? ', ' : ''}
                </span>
              ))}
              {handCards.length === 0 && <span style={{ color: '#6b7280' }}>(select cards)</span>}
              {' '}into your hand, then put the rest on top of your library
            </>
          ) : willShuffle ? (
            <>
              <strong>Effect:</strong> Shuffle your library{drawAfter && ', then draw a card (random from entire library)'}
            </>
          ) : drawAfter ? (
            <>
              <strong>Effect:</strong> Put cards back in the order shown, then draw{' '}
              <strong style={{ color: '#22c55e' }}>{cardById.get(libraryOrder[0])?.name || 'the top card'}</strong>
            </>
          ) : (
            <>
              <strong>Effect:</strong> Put cards back on top of your library in the order shown
            </>
          )}
        </div>
        
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
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
            onClick={handleConfirm}
            disabled={!isValid}
            style={{
              padding: '10px 24px',
              background: isValid ? '#8b5cf6' : '#4b5563',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: isValid ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
              opacity: isValid ? 1 : 0.6,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default PonderModal;
