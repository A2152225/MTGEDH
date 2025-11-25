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
  moveTo?: 'hand' | 'battlefield' | 'top' | 'graveyard';
  shuffleAfter?: boolean;
  onConfirm: (selectedCardIds: string[], moveTo: string) => void;
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
  onConfirm,
  onCancel,
}: LibrarySearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState(moveTo);
  
  // Filter and search cards
  const filteredCards = useMemo(() => {
    let result = cards;
    
    // Apply type/attribute filter first
    if (filter) {
      result = result.filter(card => matchesFilter(card, filter));
    }
    
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
  }, [cards, filter, searchQuery]);
  
  const toggleSelect = useCallback((cardId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else if (next.size < maxSelections) {
        next.add(cardId);
      }
      return next;
    });
  }, [maxSelections]);
  
  const handleConfirm = () => {
    onConfirm(Array.from(selectedIds), destination);
  };
  
  if (!open) return null;
  
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
    >
      <div
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
            {filteredCards.length} cards available
            {maxSelections > 1 ? ` • Select up to ${maxSelections}` : ' • Select 1 card'}
            {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
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
              No cards match your search.
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
        
        {/* Destination selector */}
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
        
        {/* Selected cards preview */}
        {selectedIds.size > 0 && (
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
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: selectedIds.size > 0 ? '#3b82f6' : '#4a4a6a',
              color: '#fff',
              cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
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
