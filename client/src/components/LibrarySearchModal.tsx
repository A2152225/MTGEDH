/**
 * LibrarySearchModal.tsx
 * 
 * A modal for searching through a player's library.
 * Used for tutor effects like "search your library for a card".
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface LibrarySearchModalProps {
  open: boolean;
  cards: KnownCardRef[];
  playerId: string;
  title?: string;
  description?: string;
  filter?: {
    types?: string[];      // e.g., ['creature', 'planeswalker']
    subtypes?: string[];   // e.g., ['forest', 'island']
    maxCmc?: number;
    minCmc?: number;
    colors?: string[];
  };
  maxSelections?: number;  // Default 1 for most tutors
  moveTo?: 'hand' | 'battlefield' | 'top' | 'graveyard' | 'split';
  shuffleAfter?: boolean;
  // For split destination effects (Cultivate, Kodama's Reach)
  splitDestination?: boolean;
  toBattlefield?: number;  // Number of cards to put on battlefield
  toHand?: number;         // Number of cards to put in hand
  entersTapped?: boolean;  // Whether battlefield cards enter tapped
  onConfirm: (selectedCardIds: string[], moveTo: string, splitAssignments?: { toBattlefield: string[]; toHand: string[] }) => void;
  onCancel: () => void;
}

function matchesFilter(card: KnownCardRef, filter: LibrarySearchModalProps['filter']): boolean {
  if (!filter) return true;
  
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Type filter
  if (filter.types && filter.types.length > 0) {
    const matchesType = filter.types.some(t => typeLine.includes(t.toLowerCase()));
    if (!matchesType) return false;
  }
  
  // Subtype filter (e.g., for fetch lands)
  if (filter.subtypes && filter.subtypes.length > 0) {
    const matchesSubtype = filter.subtypes.some(st => typeLine.includes(st.toLowerCase()));
    if (!matchesSubtype) return false;
  }
  
  // CMC filter
  const cmc = card.cmc ?? 0;
  if (filter.maxCmc !== undefined && cmc > filter.maxCmc) return false;
  if (filter.minCmc !== undefined && cmc < filter.minCmc) return false;
  
  // Color filter
  if (filter.colors && filter.colors.length > 0) {
    const cardColors = card.colors || [];
    const matchesColor = filter.colors.some(c => cardColors.includes(c.toUpperCase()));
    if (!matchesColor && cardColors.length > 0) return false;
  }
  
  return true;
}

export function LibrarySearchModal({
  open,
  cards,
  playerId,
  title = 'Search Library',
  description,
  filter,
  maxSelections = 1,
  moveTo = 'hand',
  shuffleAfter = true,
  splitDestination = false,
  toBattlefield = 0,
  toHand = 0,
  entersTapped = false,
  onConfirm,
  onCancel,
}: LibrarySearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState(moveTo === 'split' ? 'hand' : moveTo);
  
  // For split destination: track which cards go where
  const [battlefieldAssignments, setBattlefieldAssignments] = useState<Set<string>>(new Set());
  const [handAssignments, setHandAssignments] = useState<Set<string>>(new Set());
  
  // Get cards that match the type/attribute filter (before text search)
  // This represents all valid targets for the tutor
  const validTargetCards = useMemo(() => {
    if (!filter) return cards;
    return cards.filter(card => matchesFilter(card, filter));
  }, [cards, filter]);
  
  // Check if there are any valid targets at all
  const hasValidTargets = validTargetCards.length > 0;
  
  // Filter and search cards (apply text search on top of filter)
  const filteredCards = useMemo(() => {
    let result = validTargetCards;
    
    // Apply text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(card => 
        (card.name || '').toLowerCase().includes(query) ||
        (card.type_line || '').toLowerCase().includes(query) ||
        (card.oracle_text || '').toLowerCase().includes(query)
      );
    }
    
    // Sort by name
    return result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [validTargetCards, searchQuery]);
  
  const toggleSelect = useCallback((cardId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
        // Also remove from split assignments if in split mode
        if (splitDestination) {
          setBattlefieldAssignments(ba => {
            const newBa = new Set(ba);
            newBa.delete(cardId);
            return newBa;
          });
          setHandAssignments(ha => {
            const newHa = new Set(ha);
            newHa.delete(cardId);
            return newHa;
          });
        }
      } else if (next.size < maxSelections) {
        next.add(cardId);
      }
      return next;
    });
  }, [maxSelections, splitDestination]);
  
  // Handle assigning a selected card to battlefield (for split destination)
  const assignToBattlefield = useCallback((cardId: string) => {
    if (!splitDestination || !selectedIds.has(cardId)) return;
    if (battlefieldAssignments.size >= toBattlefield && !battlefieldAssignments.has(cardId)) {
      return; // Already have enough battlefield assignments
    }
    
    setHandAssignments(prev => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    setBattlefieldAssignments(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, [splitDestination, selectedIds, battlefieldAssignments.size, toBattlefield]);
  
  // Handle assigning a selected card to hand (for split destination)
  const assignToHand = useCallback((cardId: string) => {
    if (!splitDestination || !selectedIds.has(cardId)) return;
    if (handAssignments.size >= toHand && !handAssignments.has(cardId)) {
      return; // Already have enough hand assignments
    }
    
    setBattlefieldAssignments(prev => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
    setHandAssignments(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, [splitDestination, selectedIds, handAssignments.size, toHand]);
  
  // Check if split destination assignments are complete
  const splitAssignmentsComplete = !splitDestination || 
    (battlefieldAssignments.size === toBattlefield && handAssignments.size === toHand);
  
  const handleConfirm = () => {
    if (splitDestination) {
      onConfirm(
        Array.from(selectedIds), 
        'split',
        {
          toBattlefield: Array.from(battlefieldAssignments),
          toHand: Array.from(handAssignments),
        }
      );
    } else {
      onConfirm(Array.from(selectedIds), destination);
    }
  };
  
  // Handle backdrop click - only allow closing if no valid targets
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle clicks directly on the backdrop, not on children
    if (e.target !== e.currentTarget) return;
    
    // If there are valid targets, don't allow closing by clicking outside
    if (hasValidTargets) {
      return;
    }
    
    // No valid targets - allow closing
    onCancel();
  };
  
  if (!open) return null;
  
  // If no valid targets exist, show a special "no targets" state
  if (!hasValidTargets) {
    return (
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
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
            padding: 32,
            maxWidth: 500,
            width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
          <div style={{ marginTop: 12, fontSize: 14, color: '#f87171' }}>
            No valid targets found in library.
          </div>
          {filter && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              {filter.types && filter.types.length > 0 && (
                <div>Required type: {filter.types.join(' or ')}</div>
              )}
              {filter.subtypes && filter.subtypes.length > 0 && (
                <div>Required subtype: {filter.subtypes.join(' or ')}</div>
              )}
              {filter.maxCmc !== undefined && (
                <div>Maximum mana value: {filter.maxCmc}</div>
              )}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
            {shuffleAfter && 'Library will be shuffled.'}
          </div>
          <button
            onClick={onCancel}
            style={{
              marginTop: 20,
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: '#3b82f6',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            OK
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 20,
          maxWidth: 1000,
          width: '95%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
          {description && (
            <div style={{ marginTop: 6, fontSize: 13, color: '#888' }}>{description}</div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
            {validTargetCards.length} valid targets available
            {maxSelections > 1 ? ` • Select up to ${maxSelections}` : ' • Select 1 card'}
            {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#f59e0b' }}>
            ⚠️ You must select a card or fail to find (cannot close by clicking outside)
          </div>
        </div>
        
        {/* Search */}
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, type, or text..."
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: '#252540',
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>
        
        {/* Card Grid */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #3a3a5a',
            borderRadius: 6,
            backgroundColor: '#252540',
          }}
        >
          {filteredCards.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
              No cards match your search. Try a different search term.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: 8,
                padding: 12,
              }}
            >
              {filteredCards.map(card => {
                const isSelected = selectedIds.has(card.id);
                return (
                  <div
                    key={card.id}
                    onClick={() => toggleSelect(card.id)}
                    onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'right' })}
                    onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
                    style={{
                      position: 'relative',
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: isSelected ? '3px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden' }}>
                      {card.image_uris?.normal || card.image_uris?.small ? (
                        <img
                          src={card.image_uris.small || card.image_uris.normal}
                          alt={card.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, textAlign: 'center', padding: 6 }}>
                          {card.name}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        padding: '6px 8px',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.name}
                    </div>
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          backgroundColor: '#3b82f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Destination selector - only shown for non-split modes */}
        {!splitDestination && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#888' }}>Move to:</span>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value as typeof moveTo)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #4a4a6a',
                backgroundColor: '#252540',
                color: '#fff',
                fontSize: 13,
              }}
            >
              <option value="hand">Hand</option>
              <option value="battlefield">Battlefield</option>
              <option value="top">Top of Library</option>
              <option value="graveyard">Graveyard</option>
            </select>
            {shuffleAfter && (
              <span style={{ fontSize: 11, color: '#666' }}>
                (Library will be shuffled after)
              </span>
            )}
          </div>
        )}
        
        {/* Split destination UI - for Cultivate/Kodama's Reach style effects */}
        {splitDestination && selectedIds.size > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ 
              fontSize: 13, 
              color: '#f59e0b', 
              marginBottom: 12,
              padding: '10px 12px',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              borderRadius: 6,
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}>
              📋 Choose where each card goes:
              <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                {toBattlefield > 0 && `• ${toBattlefield} to battlefield${entersTapped ? ' (tapped)' : ''}`}
                {toHand > 0 && ` • ${toHand} to hand`}
              </div>
            </div>
            
            {/* Selected cards with destination assignment */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from(selectedIds).map(id => {
                const card = cards.find(c => c.id === id);
                const isBattlefield = battlefieldAssignments.has(id);
                const isHand = handAssignments.has(id);
                const isUnassigned = !isBattlefield && !isHand;
                
                return card ? (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      backgroundColor: isUnassigned 
                        ? 'rgba(239, 68, 68, 0.1)' 
                        : 'rgba(59, 130, 246, 0.1)',
                      border: `1px solid ${isUnassigned ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {card.image_uris?.small && (
                        <img 
                          src={card.image_uris.small} 
                          alt={card.name}
                          style={{ width: 30, height: 42, borderRadius: 3, objectFit: 'cover' }}
                        />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{card.name}</span>
                      {isUnassigned && (
                        <span style={{ fontSize: 11, color: '#ef4444' }}>(unassigned)</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {toBattlefield > 0 && (
                        <button
                          onClick={() => assignToBattlefield(id)}
                          disabled={!isBattlefield && battlefieldAssignments.size >= toBattlefield}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 4,
                            border: isBattlefield ? '2px solid #10b981' : '1px solid #4a4a6a',
                            backgroundColor: isBattlefield ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                            color: isBattlefield ? '#10b981' : '#888',
                            cursor: isBattlefield || battlefieldAssignments.size < toBattlefield ? 'pointer' : 'not-allowed',
                            fontSize: 12,
                            opacity: !isBattlefield && battlefieldAssignments.size >= toBattlefield ? 0.5 : 1,
                          }}
                        >
                          🏠 Battlefield{entersTapped ? ' (tapped)' : ''}
                        </button>
                      )}
                      {toHand > 0 && (
                        <button
                          onClick={() => assignToHand(id)}
                          disabled={!isHand && handAssignments.size >= toHand}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 4,
                            border: isHand ? '2px solid #3b82f6' : '1px solid #4a4a6a',
                            backgroundColor: isHand ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                            color: isHand ? '#3b82f6' : '#888',
                            cursor: isHand || handAssignments.size < toHand ? 'pointer' : 'not-allowed',
                            fontSize: 12,
                            opacity: !isHand && handAssignments.size >= toHand ? 0.5 : 1,
                          }}
                        >
                          ✋ Hand
                        </button>
                      )}
                      <button
                        onClick={() => toggleSelect(id)}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: '1px solid #4a4a6a',
                          backgroundColor: 'transparent',
                          color: '#888',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                        title="Remove from selection"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : null;
              })}
            </div>
            
            {/* Assignment status */}
            <div style={{ marginTop: 8, fontSize: 11, color: splitAssignmentsComplete ? '#10b981' : '#f59e0b' }}>
              {splitAssignmentsComplete 
                ? '✓ All cards assigned' 
                : `Assign ${toBattlefield - battlefieldAssignments.size} more to battlefield, ${toHand - handAssignments.size} more to hand`}
            </div>
          </div>
        )}
        
        {/* Selected cards preview - only for non-split mode */}
        {!splitDestination && selectedIds.size > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Selected:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Array.from(selectedIds).map(id => {
                const card = cards.find(c => c.id === id);
                return card ? (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {card.name}
                    <button
                      onClick={() => toggleSelect(id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#888',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
        
        {/* Action buttons */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onCancel}
            title="Fail to find - choose not to select a card"
            style={{
              padding: '10px 20px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Fail to Find
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0 || (splitDestination && !splitAssignmentsComplete)}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: (selectedIds.size > 0 && (!splitDestination || splitAssignmentsComplete)) ? '#3b82f6' : '#4a4a6a',
              color: '#fff',
              cursor: (selectedIds.size > 0 && (!splitDestination || splitAssignmentsComplete)) ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}

export default LibrarySearchModal;
