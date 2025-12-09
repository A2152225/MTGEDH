/**
 * GraveyardViewModal.tsx
 * 
 * A modal for viewing and interacting with cards in the graveyard.
 * Supports activating abilities like flashback and unearth.
 */

import React, { useState, useMemo } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface GraveyardAbility {
  id: string;
  label: string;
  description: string;
  cost?: string;
}

export interface GraveyardViewModalProps {
  open: boolean;
  cards: KnownCardRef[];
  playerId: string;
  canActivate?: boolean;
  onClose: () => void;
  onActivateAbility?: (cardId: string, abilityId: string, card: KnownCardRef) => void;
  playableCards?: string[];
}

/**
 * Parse graveyard-activatable abilities from a card's oracle text
 */
function parseGraveyardAbilities(card: KnownCardRef): GraveyardAbility[] {
  const abilities: GraveyardAbility[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Flashback - cast from graveyard
  if (oracleText.includes('flashback')) {
    const flashbackMatch = card.oracle_text?.match(/flashback[^(]*\{([^}]+)\}/i) ||
                          card.oracle_text?.match(/flashback[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = flashbackMatch ? flashbackMatch[1] : card.mana_cost || 'unknown';
    abilities.push({
      id: 'flashback',
      label: 'Flashback',
      description: `Cast from graveyard for ${cost}`,
      cost,
    });
  }
  
  // Unearth - return from graveyard to battlefield
  if (oracleText.includes('unearth')) {
    const unearthMatch = card.oracle_text?.match(/unearth\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = unearthMatch ? unearthMatch[1] : 'unknown';
    abilities.push({
      id: 'unearth',
      label: 'Unearth',
      description: `Return to battlefield for ${cost}`,
      cost,
    });
  }
  
  // Escape - cast from graveyard (Theros)
  if (oracleText.includes('escape')) {
    const escapeMatch = card.oracle_text?.match(/escape[—\-]([^(]+)/i);
    const cost = escapeMatch ? escapeMatch[1].trim() : 'unknown';
    abilities.push({
      id: 'escape',
      label: 'Escape',
      description: `Cast from graveyard: ${cost}`,
      cost,
    });
  }
  
  // Embalm - create token copy
  if (oracleText.includes('embalm')) {
    const embalmMatch = card.oracle_text?.match(/embalm\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = embalmMatch ? embalmMatch[1] : 'unknown';
    abilities.push({
      id: 'embalm',
      label: 'Embalm',
      description: `Create token copy for ${cost}`,
      cost,
    });
  }
  
  // Eternalize - create 4/4 token copy
  if (oracleText.includes('eternalize')) {
    const eternalizeMatch = card.oracle_text?.match(/eternalize\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = eternalizeMatch ? eternalizeMatch[1] : 'unknown';
    abilities.push({
      id: 'eternalize',
      label: 'Eternalize',
      description: `Create 4/4 token copy for ${cost}`,
      cost,
    });
  }
  
  // Jump-start - cast from graveyard and discard
  if (oracleText.includes('jump-start')) {
    abilities.push({
      id: 'jump-start',
      label: 'Jump-start',
      description: `Cast from graveyard, discard a card`,
      cost: card.mana_cost,
    });
  }
  
  // Retrace - cast from graveyard by discarding a land
  if (oracleText.includes('retrace')) {
    abilities.push({
      id: 'retrace',
      label: 'Retrace',
      description: `Cast from graveyard by discarding a land`,
      cost: card.mana_cost,
    });
  }
  
  // Generic activated abilities from graveyard
  // Look for patterns like "Tap X [creatures/permanents]: Return ~ from your graveyard"
  // or abilities that can be activated while in graveyard
  // Example: Summon the School - "Tap four untapped Merfolk you control: Return Summon the School from your graveyard to your hand."
  
  // Pattern: "[Cost]: Return ~ from your graveyard to your hand/battlefield"
  const returnFromGraveyardMatch = card.oracle_text?.match(/([^.]+):\s*return\s+(?:~|this card|[^.]+)\s+from\s+your\s+graveyard\s+to\s+(?:your\s+)?(hand|the battlefield)/i);
  if (returnFromGraveyardMatch) {
    const cost = returnFromGraveyardMatch[1].trim();
    const destination = returnFromGraveyardMatch[2].toLowerCase();
    abilities.push({
      id: 'return-from-graveyard',
      label: 'Return from Graveyard',
      description: `${cost}: Return to ${destination}`,
      cost,
    });
  }
  
  // Pattern for activated abilities that work from graveyard
  // Look for "Activate only if ~ is in your graveyard" or similar
  if (oracleText.includes('activate') && (oracleText.includes('graveyard') || oracleText.includes('from your graveyard'))) {
    // Try to extract the ability cost and effect
    const activateMatch = card.oracle_text?.match(/([^.]+):\s*([^.]+)\.\s*(?:activate|you may activate)[^.]*(?:graveyard|from your graveyard)/i);
    if (activateMatch && !abilities.some(a => a.id === 'return-from-graveyard')) {
      abilities.push({
        id: 'graveyard-activated',
        label: 'Graveyard Ability',
        description: `${activateMatch[1].trim()}: ${activateMatch[2].trim()}`,
        cost: activateMatch[1].trim(),
      });
    }
  }
  
  // Scavenge - exile from graveyard to put +1/+1 counters
  if (oracleText.includes('scavenge')) {
    const scavengeMatch = card.oracle_text?.match(/scavenge\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = scavengeMatch ? scavengeMatch[1] : 'unknown';
    abilities.push({
      id: 'scavenge',
      label: 'Scavenge',
      description: `Exile to put +1/+1 counters for ${cost}`,
      cost,
    });
  }
  
  // Encore - create token copies that attack each opponent
  if (oracleText.includes('encore')) {
    const encoreMatch = card.oracle_text?.match(/encore\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = encoreMatch ? encoreMatch[1] : 'unknown';
    abilities.push({
      id: 'encore',
      label: 'Encore',
      description: `Create tokens for each opponent for ${cost}`,
      cost,
    });
  }
  
  // Disturb - cast transformed from graveyard
  if (oracleText.includes('disturb')) {
    const disturbMatch = card.oracle_text?.match(/disturb\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    const cost = disturbMatch ? disturbMatch[1] : 'unknown';
    abilities.push({
      id: 'disturb',
      label: 'Disturb',
      description: `Cast transformed from graveyard for ${cost}`,
      cost,
    });
  }
  
  // Persist - returns with -1/-1 counter
  if (oracleText.includes('persist')) {
    abilities.push({
      id: 'persist-info',
      label: 'Has Persist',
      description: 'When this dies without -1/-1 counter, it returns',
      cost: 'automatic',
    });
  }
  
  // Undying - returns with +1/+1 counter
  if (oracleText.includes('undying')) {
    abilities.push({
      id: 'undying-info',
      label: 'Has Undying',
      description: 'When this dies without +1/+1 counter, it returns',
      cost: 'automatic',
    });
  }
  
  return abilities;
}

export function GraveyardViewModal({
  open,
  cards,
  playerId,
  canActivate = true,
  onClose,
  onActivateAbility,
  playableCards = [],
}: GraveyardViewModalProps) {
  const [selectedCard, setSelectedCard] = useState<KnownCardRef | null>(null);
  const [filter, setFilter] = useState('');
  
  // Parse abilities for each card
  const cardsWithAbilities = useMemo(() => {
    return cards.map(card => ({
      card,
      abilities: parseGraveyardAbilities(card),
    }));
  }, [cards]);
  
  // Filter cards
  const filteredCards = useMemo(() => {
    if (!filter.trim()) return cardsWithAbilities;
    const lowerFilter = filter.toLowerCase();
    return cardsWithAbilities.filter(({ card }) => 
      (card.name || '').toLowerCase().includes(lowerFilter) ||
      (card.type_line || '').toLowerCase().includes(lowerFilter)
    );
  }, [cardsWithAbilities, filter]);
  
  // Cards with activatable abilities
  const activatableCards = useMemo(() => {
    return filteredCards.filter(({ abilities }) => abilities.length > 0);
  }, [filteredCards]);
  
  if (!open) return null;
  
  const handleActivate = (card: KnownCardRef, abilityId: string) => {
    if (onActivateAbility && card.id) {
      onActivateAbility(card.id, abilityId, card);
    }
    onClose();
  };
  
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 20,
          maxWidth: 900,
          width: '95%',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            Graveyard ({cards.length} cards)
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 24,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>
        
        {/* Filter */}
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or type..."
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: '#252540',
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>
        
        {/* Quick access section for cards with abilities */}
        {activatableCards.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8, fontWeight: 600 }}>
              Cards with Activatable Abilities:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {activatableCards.map(({ card, abilities }) => (
                <div
                  key={card.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: 8,
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    borderRadius: 8,
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                  }}
                >
                  <div
                    style={{
                      width: 80,
                      height: 112,
                      borderRadius: 6,
                      overflow: 'hidden',
                      marginBottom: 6,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'right' })}
                    onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
                  >
                    {card.image_uris?.normal || card.image_uris?.small ? (
                      <img
                        src={card.image_uris.normal || card.image_uris.small}
                        alt={card.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, textAlign: 'center', padding: 4 }}>
                        {card.name}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, textAlign: 'center', marginBottom: 4, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.name}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {abilities.map((ability) => (
                      <button
                        key={ability.id}
                        onClick={() => canActivate && handleActivate(card, ability.id)}
                        disabled={!canActivate}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: 'none',
                          backgroundColor: canActivate ? '#3b82f6' : '#4a4a6a',
                          color: '#fff',
                          fontSize: 10,
                          cursor: canActivate ? 'pointer' : 'not-allowed',
                          fontWeight: 500,
                        }}
                        title={ability.description}
                      >
                        {ability.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Full graveyard list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8, fontWeight: 600 }}>
            All Cards (newest first):
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 8,
            }}
          >
            {[...filteredCards].reverse().map(({ card, abilities }) => {
              const isPlayable = playableCards.includes(card.id);
              
              return (
              <div
                key={card.id}
                style={{
                  position: 'relative',
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: abilities.length > 0 ? '2px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255,255,255,0.1)',
                  backgroundColor: '#252540',
                  cursor: 'pointer',
                  boxShadow: isPlayable ? '0 0 8px 3px rgba(34, 197, 94, 0.8), 0 0 0 2px #22c55e' : 'none',
                }}
                onClick={() => setSelectedCard(selectedCard?.id === card.id ? null : card)}
                onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'above' })}
                onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
              >
                <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden' }}>
                  {card.image_uris?.normal || card.image_uris?.small ? (
                    <img
                      src={card.image_uris.small || card.image_uris.normal}
                      alt={card.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, textAlign: 'center', padding: 4 }}>
                      {card.name}
                    </div>
                  )}
                </div>
                {abilities.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      backgroundColor: 'rgba(59, 130, 246, 0.9)',
                      color: '#fff',
                      fontSize: 9,
                      padding: '2px 4px',
                      borderRadius: 3,
                      fontWeight: 600,
                    }}
                  >
                    ⚡
                  </div>
                )}
                <div
                  style={{
                    padding: '4px 6px',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                  }}
                >
                  {card.name}
                </div>
              </div>
            );
            })}
          </div>
        </div>
        
        {/* Selected card abilities panel */}
        {selectedCard && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: '#252540',
              borderRadius: 8,
              border: '1px solid #4a4a6a',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{selectedCard.name}</div>
              <button
                onClick={() => setSelectedCard(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
              {selectedCard.type_line}
            </div>
            {parseGraveyardAbilities(selectedCard).length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {parseGraveyardAbilities(selectedCard).map((ability) => (
                  <button
                    key={ability.id}
                    onClick={() => canActivate && handleActivate(selectedCard, ability.id)}
                    disabled={!canActivate}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      border: 'none',
                      backgroundColor: canActivate ? '#3b82f6' : '#4a4a6a',
                      color: '#fff',
                      fontSize: 13,
                      cursor: canActivate ? 'pointer' : 'not-allowed',
                      fontWeight: 500,
                    }}
                    title={ability.description}
                  >
                    {ability.label}: {ability.cost}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#666' }}>
                No graveyard abilities available for this card.
              </div>
            )}
          </div>
        )}
        
        {/* Close button */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: '1px solid #4a4a6a',
              backgroundColor: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default GraveyardViewModal;
