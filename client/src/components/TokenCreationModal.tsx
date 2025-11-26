/**
 * TokenCreationModal.tsx
 * 
 * Modal for creating tokens during gameplay.
 * Provides UI for:
 * - Selecting from common token types
 * - Specifying token count
 * - Adding counters to created tokens
 * - Custom token creation
 */

import React, { useState, useMemo } from 'react';

// Common token types for quick selection
const COMMON_TOKEN_PRESETS = [
  // Artifact tokens
  { id: 'treasure', name: 'Treasure', type: 'Artifact', colors: [], abilities: 'Tap, Sacrifice: Add one mana of any color.' },
  { id: 'food', name: 'Food', type: 'Artifact', colors: [], abilities: 'Pay 2, Tap, Sacrifice: Gain 3 life.' },
  { id: 'clue', name: 'Clue', type: 'Artifact', colors: [], abilities: 'Pay 2, Sacrifice: Draw a card.' },
  { id: 'blood', name: 'Blood', type: 'Artifact', colors: [], abilities: 'Pay 1, Tap, Discard, Sacrifice: Draw a card.' },
  { id: 'map', name: 'Map', type: 'Artifact', colors: [], abilities: 'Pay 1, Tap, Sacrifice: Explore.' },
  { id: 'powerstone', name: 'Powerstone', type: 'Artifact', colors: [], abilities: 'Tap: Add {C}. (Artifacts only)' },
  
  // White creature tokens
  { id: 'soldier', name: '1/1 Soldier', type: 'Creature', subtype: 'Soldier', colors: ['W'], power: 1, toughness: 1 },
  { id: 'spirit', name: '1/1 Spirit', type: 'Creature', subtype: 'Spirit', colors: ['W'], power: 1, toughness: 1, abilities: 'Flying' },
  { id: 'human', name: '1/1 Human', type: 'Creature', subtype: 'Human', colors: ['W'], power: 1, toughness: 1 },
  { id: 'angel', name: '4/4 Angel', type: 'Creature', subtype: 'Angel', colors: ['W'], power: 4, toughness: 4, abilities: 'Flying' },
  
  // Black creature tokens
  { id: 'zombie', name: '2/2 Zombie', type: 'Creature', subtype: 'Zombie', colors: ['B'], power: 2, toughness: 2 },
  { id: 'bat', name: '1/1 Bat', type: 'Creature', subtype: 'Bat', colors: ['B'], power: 1, toughness: 1, abilities: 'Flying' },
  { id: 'demon', name: '5/5 Demon', type: 'Creature', subtype: 'Demon', colors: ['B'], power: 5, toughness: 5, abilities: 'Flying' },
  
  // Red creature tokens
  { id: 'goblin', name: '1/1 Goblin', type: 'Creature', subtype: 'Goblin', colors: ['R'], power: 1, toughness: 1 },
  { id: 'devil', name: '1/1 Devil', type: 'Creature', subtype: 'Devil', colors: ['R'], power: 1, toughness: 1, abilities: 'When this dies, deals 1 damage.' },
  { id: 'dragon', name: '5/5 Dragon', type: 'Creature', subtype: 'Dragon', colors: ['R'], power: 5, toughness: 5, abilities: 'Flying' },
  { id: 'elemental_r', name: '3/1 Elemental', type: 'Creature', subtype: 'Elemental', colors: ['R'], power: 3, toughness: 1, abilities: 'Haste' },
  
  // Green creature tokens
  { id: 'beast', name: '3/3 Beast', type: 'Creature', subtype: 'Beast', colors: ['G'], power: 3, toughness: 3 },
  { id: 'saproling', name: '1/1 Saproling', type: 'Creature', subtype: 'Saproling', colors: ['G'], power: 1, toughness: 1 },
  { id: 'wolf', name: '2/2 Wolf', type: 'Creature', subtype: 'Wolf', colors: ['G'], power: 2, toughness: 2 },
  { id: 'elf', name: '1/1 Elf Warrior', type: 'Creature', subtype: 'Elf Warrior', colors: ['G'], power: 1, toughness: 1 },
  { id: 'elemental_g', name: '4/4 Elemental', type: 'Creature', subtype: 'Elemental', colors: ['G'], power: 4, toughness: 4 },
  
  // Colorless creature tokens
  { id: 'thopter', name: '1/1 Thopter', type: 'Artifact Creature', subtype: 'Thopter', colors: [], power: 1, toughness: 1, abilities: 'Flying' },
  { id: 'servo', name: '1/1 Servo', type: 'Artifact Creature', subtype: 'Servo', colors: [], power: 1, toughness: 1 },
  { id: 'construct', name: '1/1 Construct', type: 'Artifact Creature', subtype: 'Construct', colors: [], power: 1, toughness: 1 },
];

const COLOR_ICONS: Record<string, string> = {
  'W': '⚪',
  'U': '🔵',
  'B': '⚫',
  'R': '🔴',
  'G': '🟢',
};

interface TokenPreset {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  colors: string[];
  power?: number;
  toughness?: number;
  abilities?: string;
}

export interface TokenCreationModalProps {
  open: boolean;
  onCreateToken: (token: {
    name: string;
    type: string;
    subtype?: string;
    colors: string[];
    power?: number;
    toughness?: number;
    abilities?: string;
    count: number;
    counters?: Record<string, number>;
  }) => void;
  onClose: () => void;
}

export function TokenCreationModal({
  open,
  onCreateToken,
  onClose,
}: TokenCreationModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<TokenPreset | null>(null);
  const [count, setCount] = useState(1);
  const [plusCounters, setPlusCounters] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'artifact' | 'creature'>('creature');

  // Filter tokens by search and category
  const filteredTokens = useMemo(() => {
    let tokens = COMMON_TOKEN_PRESETS;
    
    // Filter by category
    if (activeCategory === 'artifact') {
      tokens = tokens.filter(t => t.type === 'Artifact');
    } else {
      tokens = tokens.filter(t => t.type.includes('Creature'));
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tokens = tokens.filter(t => 
        t.name.toLowerCase().includes(query) ||
        t.subtype?.toLowerCase().includes(query) ||
        t.abilities?.toLowerCase().includes(query)
      );
    }
    
    return tokens;
  }, [activeCategory, searchQuery]);

  const handleCreate = () => {
    if (!selectedPreset) return;
    
    const counters: Record<string, number> = {};
    if (plusCounters > 0) {
      counters['+1/+1'] = plusCounters;
    }
    
    onCreateToken({
      name: selectedPreset.name,
      type: selectedPreset.type,
      subtype: selectedPreset.subtype,
      colors: selectedPreset.colors,
      power: selectedPreset.power,
      toughness: selectedPreset.toughness,
      abilities: selectedPreset.abilities,
      count,
      counters: Object.keys(counters).length > 0 ? counters : undefined,
    });
    
    // Reset state
    setSelectedPreset(null);
    setCount(1);
    setPlusCounters(0);
    onClose();
  };

  const resetAndClose = () => {
    setSelectedPreset(null);
    setCount(1);
    setPlusCounters(0);
    setSearchQuery('');
    onClose();
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10003,
      }}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 700,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            ✨ Create Token
          </h2>
          <button
            onClick={resetAndClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 24,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setActiveCategory('creature')}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: activeCategory === 'creature' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeCategory === 'creature' ? 600 : 400,
            }}
          >
            🐾 Creatures
          </button>
          <button
            onClick={() => setActiveCategory('artifact')}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: activeCategory === 'artifact' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeCategory === 'artifact' ? 600 : 400,
            }}
          >
            ⚙️ Artifacts
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search tokens..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 6,
            border: '1px solid #4a4a6a',
            backgroundColor: 'rgba(0,0,0,0.3)',
            color: '#fff',
            fontSize: 14,
            marginBottom: 16,
            boxSizing: 'border-box',
          }}
        />

        {/* Token grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 10,
          marginBottom: 20,
          maxHeight: 300,
          overflow: 'auto',
        }}>
          {filteredTokens.map(token => {
            const isSelected = selectedPreset?.id === token.id;
            const colorIcons = token.colors.map(c => COLOR_ICONS[c]).join('');
            
            return (
              <button
                key={token.id}
                onClick={() => setSelectedPreset(token)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: 10,
                  borderRadius: 8,
                  border: isSelected 
                    ? '2px solid #10b981' 
                    : '2px solid #4a4a6a',
                  backgroundColor: isSelected 
                    ? 'rgba(16,185,129,0.2)' 
                    : 'rgba(0,0,0,0.3)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 4 }}>
                  {token.type === 'Artifact' ? '⚙️' : 
                   token.colors.includes('W') ? '⚪' :
                   token.colors.includes('U') ? '🔵' :
                   token.colors.includes('B') ? '⚫' :
                   token.colors.includes('R') ? '🔴' :
                   token.colors.includes('G') ? '🟢' : '⬜'}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                  {token.name}
                </div>
                {token.power !== undefined && (
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {token.power}/{token.toughness}
                  </div>
                )}
                {token.abilities && (
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>
                    {token.abilities.length > 25 ? token.abilities.slice(0, 25) + '...' : token.abilities}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Token configuration */}
        {selectedPreset && (
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Creating: {selectedPreset.name}
            </div>
            
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {/* Count */}
              <div>
                <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 4 }}>
                  Number of tokens
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setCount(Math.max(1, count - 1))}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: '1px solid #4a4a6a',
                      backgroundColor: 'transparent',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 18,
                    }}
                  >
                    -
                  </button>
                  <span style={{ fontSize: 18, fontWeight: 600, minWidth: 30, textAlign: 'center' }}>
                    {count}
                  </span>
                  <button
                    onClick={() => setCount(count + 1)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: '1px solid #4a4a6a',
                      backgroundColor: 'transparent',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 18,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* +1/+1 Counters (for creatures) */}
              {selectedPreset.power !== undefined && (
                <div>
                  <label style={{ fontSize: 12, color: '#aaa', display: 'block', marginBottom: 4 }}>
                    +1/+1 Counters
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => setPlusCounters(Math.max(0, plusCounters - 1))}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: '1px solid #4a4a6a',
                        backgroundColor: 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 18,
                      }}
                    >
                      -
                    </button>
                    <span style={{ fontSize: 18, fontWeight: 600, minWidth: 30, textAlign: 'center' }}>
                      {plusCounters}
                    </span>
                    <button
                      onClick={() => setPlusCounters(plusCounters + 1)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        border: '1px solid #4a4a6a',
                        backgroundColor: 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 18,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Summary */}
            {selectedPreset.power !== undefined && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#aaa' }}>
                Final stats: {(selectedPreset.power || 0) + plusCounters}/{(selectedPreset.toughness || 0) + plusCounters}
                {plusCounters > 0 && ` (+${plusCounters}/+${plusCounters} from counters)`}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
          paddingTop: 16,
          borderTop: '1px solid #333',
        }}>
          <button
            onClick={resetAndClose}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
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
            onClick={handleCreate}
            disabled={!selectedPreset}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: selectedPreset ? '#10b981' : '#333',
              color: selectedPreset ? '#fff' : '#666',
              cursor: selectedPreset ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Create {count > 1 ? `${count} Tokens` : 'Token'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TokenCreationModal;
