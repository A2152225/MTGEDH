/**
 * ExileViewModal.tsx
 * 
 * A modal for viewing and interacting with cards in exile.
 * Supports foretell, suspend, rebound, escape, plot, and other exile mechanics.
 */

import React, { useState, useMemo } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { getPlayableCardHighlight } from '../utils/appearanceSettings';

export interface ExileAbility {
  id: string;
  label: string;
  description: string;
  cost?: string;
}

export interface ExileViewModalProps {
  open: boolean;
  cards: KnownCardRef[];
  playerId: string;
  canActivate?: boolean;
  onClose: () => void;
  onActivateAbility?: (cardId: string, abilityId: string, card: KnownCardRef) => void;
  playableCards?: string[];
  appearanceSettings?: AppearanceSettings;
  // Ignore functionality
  onIgnoreForPlayability?: (cardId: string, cardName: string, imageUrl?: string) => void;
  onUnignoreForPlayability?: (cardId: string) => void;
  ignoredCardIds?: Set<string>;
}

function parseExileAbilities(card: KnownCardRef): ExileAbility[] {
  const abilities: ExileAbility[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  if (oracleText.includes('foretell')) {
    const match = card.oracle_text?.match(/foretell[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    abilities.push({
      id: 'foretell-cast',
      label: 'Foretell',
      description: `Cast from exile for ${match ? match[1] : card.mana_cost || 'cost'}`,
      cost: match ? match[1] : card.mana_cost,
    });
  }
  
  if (oracleText.includes('suspend')) {
    const match = card.oracle_text?.match(/suspend\s+(\d+)[—\-]([^(.\n]+)/i);
    abilities.push({
      id: 'suspend',
      label: 'Suspend',
      description: match ? `Suspended (${match[1]} time counters, ${match[2].trim()})` : 'Suspended',
      cost: match ? match[2].trim() : undefined,
    });
  }
  
  if (oracleText.includes('rebound')) {
    abilities.push({ id: 'rebound', label: 'Rebound', description: 'Will cast again next upkeep' });
  }
  
  if (oracleText.includes('escape')) {
    const match = card.oracle_text?.match(/escape[—\-]([^(.\n]+)/i);
    abilities.push({
      id: 'escape',
      label: 'Escape',
      description: `Cast from exile: ${match ? match[1].trim() : 'cost + exile cards'}`,
      cost: match ? match[1].trim() : undefined,
    });
  }
  
  if ((card as any).layout === 'adventure' || oracleText.includes('adventure')) {
    abilities.push({ id: 'adventure', label: 'Adventure', description: 'Cast adventure half from exile' });
  }
  
  if (oracleText.includes('plot')) {
    const match = card.oracle_text?.match(/plot[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    abilities.push({
      id: 'plot',
      label: 'Plot',
      description: `Plotted, cast on later turn (${match ? match[1] : 'cost'})`,
      cost: match ? match[1] : undefined,
    });
  }
  
  if ((oracleText.includes('you may play') || oracleText.includes('you may cast')) && 
      (oracleText.includes('from exile') || oracleText.includes('this turn'))) {
    abilities.push({ id: 'play-from-exile', label: 'Playable', description: 'May play from exile' });
  }
  
  return abilities;
}

export function ExileViewModal({
  open,
  cards,
  playerId,
  canActivate = true,
  onClose,
  onActivateAbility,
  playableCards = [],
  appearanceSettings,
  onIgnoreForPlayability,
  onUnignoreForPlayability,
  ignoredCardIds = new Set(),
}: ExileViewModalProps) {
  const [selectedCard, setSelectedCard] = useState<KnownCardRef | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'playable' | 'suspended'>('all');
  const [contextMenu, setContextMenu] = useState<{ card: KnownCardRef; x: number; y: number } | null>(null);

  const cardsWithAbilities = useMemo(() => 
    cards.map(card => ({ card, abilities: parseExileAbilities(card) })),
    [cards]
  );

  const suspendedCards = useMemo(() => 
    cardsWithAbilities.filter(({ abilities }) => abilities.some(a => a.id === 'suspend')),
    [cardsWithAbilities]
  );

  const filteredCards = useMemo(() => {
    let filtered = cardsWithAbilities;
    if (filterMode === 'playable') filtered = filtered.filter(({ card }) => playableCards.includes(card.id));
    else if (filterMode === 'suspended') filtered = suspendedCards;
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(({ card }) => 
        card.name?.toLowerCase().includes(term) ||
        card.type_line?.toLowerCase().includes(term) ||
        card.oracle_text?.toLowerCase().includes(term)
      );
    }
    return filtered;
  }, [cardsWithAbilities, filterMode, playableCards, suspendedCards, searchTerm]);

  if (!open) return null;

  const selectedIsPlayable = Boolean(selectedCard && playableCards.includes(selectedCard.id));
  const selectedIsLand = Boolean(selectedCard && /\bland\b/i.test(String(selectedCard.type_line || '')));

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e', borderRadius: 12, width: '90%', maxWidth: 900,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 16, borderBottom: '1px solid #4a4a6a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Exile Zone</h2>
            <span style={{ fontSize: 14, color: '#888', fontWeight: 'normal' }}>
              {cards.length} card{cards.length !== 1 ? 's' : ''}
              {suspendedCards.length > 0 && ` • ${suspendedCards.length} suspended`}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 12, borderBottom: '1px solid #4a4a6a', display: 'flex', gap: 8 }}>
          {[
            { mode: 'all', label: `All (${cards.length})`, color: '#7c3aed' },
            { mode: 'playable', label: `Playable (${playableCards.filter(id => cards.some(c => c.id === id)).length})`, color: '#22c55e' },
            { mode: 'suspended', label: `Suspended (${suspendedCards.length})`, color: '#f59e0b' },
          ].map(({ mode, label, color }) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode as any)}
              style={{
                padding: '6px 12px', backgroundColor: filterMode === mode ? color : '#252540',
                border: '1px solid #4a4a6a', borderRadius: 4, color: '#fff',
                cursor: 'pointer', fontSize: 12,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: 12, borderBottom: '1px solid #4a4a6a' }}>
          <input
            type="text"
            placeholder="Search cards..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', backgroundColor: '#252540',
              border: '1px solid #4a4a6a', borderRadius: 6, color: '#fff', fontSize: 14,
            }}
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {cards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Exile zone is empty</div>
          ) : filteredCards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>No cards match your filters</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              {[...filteredCards].reverse().map(({ card, abilities }) => {
                const isPlayable = playableCards.includes(card.id);
                const isSuspended = abilities.some(a => a.id === 'suspend');
                const isIgnored = ignoredCardIds.has(card.id);
                
                return (
                  <div
                    key={card.id}
                    style={{
                      position: 'relative', borderRadius: 6, overflow: 'hidden',
                      border: isIgnored 
                        ? '2px solid rgba(250, 204, 21, 0.5)'
                        : isSuspended 
                          ? '2px solid rgba(245,158,11,0.5)' 
                          : abilities.length > 0 
                            ? '2px solid rgba(147,51,234,0.5)' 
                            : '1px solid rgba(255,255,255,0.1)',
                      backgroundColor: '#252540', cursor: 'pointer',
                      boxShadow: isPlayable ? getPlayableCardHighlight(appearanceSettings) : 'none',
                    }}
                    onClick={() => setSelectedCard(selectedCard?.id === card.id ? null : card)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ card, x: e.clientX, y: e.clientY });
                    }}
                    onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'above' })}
                    onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
                  >
                    {/* Ignored badge */}
                    {isIgnored && (
                      <div style={{
                        position: 'absolute',
                        top: 4,
                        left: 4,
                        background: 'rgba(250, 204, 21, 0.9)',
                        borderRadius: 4,
                        padding: '2px 4px',
                        fontSize: 10,
                        color: '#000',
                        fontWeight: 600,
                        zIndex: 5,
                      }}>
                        🔇
                      </div>
                    )}
                    <div style={{ width: '100%', aspectRatio: '0.72', overflow: 'hidden' }}>
                      {card.image_uris?.small || card.image_uris?.normal ? (
                        <img src={card.image_uris.small || card.image_uris.normal} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, textAlign: 'center', padding: 4 }}>
                          {card.name}
                        </div>
                      )}
                    </div>
                    {abilities.length > 0 && !isIgnored && (
                      <div style={{ position: 'absolute', top: 4, right: 4, backgroundColor: isSuspended ? 'rgba(245,158,11,0.9)' : 'rgba(147,51,234,0.9)', color: '#fff', fontSize: 9, padding: '2px 4px', borderRadius: 3, fontWeight: 600 }}>
                        {isSuspended ? '⏱️' : '⚡'}
                      </div>
                    )}
                    <div style={{ padding: '4px 6px', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}>
                      {card.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {selectedCard && (
          <div style={{ padding: 12, backgroundColor: '#252540', borderTop: '1px solid #4a4a6a' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{selectedCard.name}</div>
              <button onClick={() => setSelectedCard(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            
            {parseExileAbilities(selectedCard).map((ability) => (
              <div key={ability.id} style={{ padding: 8, backgroundColor: '#1a1a2e', borderRadius: 6, marginBottom: 8, border: '1px solid #4a4a6a' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: ability.id === 'suspend' ? '#f59e0b' : '#a78bfa' }}>{ability.label}</div>
                  {ability.cost && <div style={{ fontSize: 12, color: '#888' }}>{ability.cost}</div>}
                </div>
                <div style={{ fontSize: 12, color: '#ccc', marginBottom: canActivate ? 8 : 0 }}>{ability.description}</div>
                {canActivate && onActivateAbility && ability.id !== 'rebound' && (
                  <button
                    onClick={() => { onActivateAbility(selectedCard.id, ability.id, selectedCard); setSelectedCard(null); }}
                    style={{ padding: '6px 12px', backgroundColor: '#7c3aed', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                  >
                    {ability.id === 'suspend' ? 'Remove Counter' : 'Activate'}
                  </button>
                )}
              </div>
            ))}

            {canActivate && onActivateAbility && selectedIsPlayable && (
              <div style={{ padding: 8, backgroundColor: '#1a1a2e', borderRadius: 6, marginBottom: 8, border: '1px solid #22c55e' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#22c55e', marginBottom: 4 }}>
                  Playable Now
                </div>
                <div style={{ fontSize: 12, color: '#ccc', marginBottom: 8 }}>
                  You have permission to {selectedIsLand ? 'play' : 'cast'} this card from exile.
                </div>
                <button
                  onClick={() => { onActivateAbility(selectedCard.id, 'playable-permission', selectedCard); setSelectedCard(null); }}
                  style={{ padding: '6px 12px', backgroundColor: '#22c55e', border: 'none', borderRadius: 4, color: '#0b0f0c', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                >
                  {selectedIsLand ? 'Play Land' : 'Cast Spell'}
                </button>
              </div>
            )}
            
            {parseExileAbilities(selectedCard).length === 0 && (
              <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', padding: 8 }}>
                No special abilities from exile
              </div>
            )}
          </div>
        )}
        
        {/* Context menu for exile cards */}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: '#1e1e2e',
              border: '1px solid #444',
              borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              minWidth: 180,
              zIndex: 10001,
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #444', fontWeight: 600, color: '#fff', fontSize: 13 }}>
              🌀 {contextMenu.card.name}
            </div>
            <div style={{ padding: '4px 0' }}>
              {ignoredCardIds.has(contextMenu.card.id) ? (
                <div
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    color: '#fcd34d',
                    fontSize: 13,
                  }}
                  onClick={() => {
                    onUnignoreForPlayability?.(contextMenu.card.id);
                    setContextMenu(null);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  🔔 Stop Ignoring
                </div>
              ) : (
                <div
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    color: '#e5e7eb',
                    fontSize: 13,
                  }}
                  onClick={() => {
                    onIgnoreForPlayability?.(
                      contextMenu.card.id, 
                      contextMenu.card.name,
                      contextMenu.card.image_uris?.small || contextMenu.card.image_uris?.normal
                    );
                    setContextMenu(null);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  🔇 Ignore for Auto-Pass
                </div>
              )}
            </div>
          </div>
        )}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
            }}
            onClick={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

export default ExileViewModal;
