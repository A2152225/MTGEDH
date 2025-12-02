/**
 * FloatingManaPool component - displays the player's current mana pool
 * Shows clickable mana icons when there is floating mana available
 * Supports both regular mana and restricted mana (mana that can only be spent on specific things)
 */
import React from 'react';
import type { ManaColor, ManaRestrictionType, RestrictedManaEntry } from '../../../shared/src';

// Mana symbol colors for styling
const MANA_SYMBOL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  white: { bg: '#fffbd5', text: '#8a6d3b', border: '#c9a227' },
  blue: { bg: '#0e68ab', text: '#fff', border: '#0a4f82' },
  black: { bg: '#150b00', text: '#c9c5c2', border: '#4a4a4a' },
  red: { bg: '#d3202a', text: '#fff', border: '#a31a22' },
  green: { bg: '#00733e', text: '#fff', border: '#005a30' },
  colorless: { bg: '#ccc2c0', text: '#333', border: '#999' },
};

const MANA_SYMBOLS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

// Icons for restricted mana types
const RESTRICTION_ICONS: Record<string, { icon: string; label: string }> = {
  creatures: { icon: '🐉', label: 'Creatures only' },
  abilities: { icon: '⚡', label: 'Abilities only' },
  colorless_spells: { icon: '◇', label: 'Colorless spells only' },
  artifacts: { icon: '⚙️', label: 'Artifacts only' },
  legendary: { icon: '👑', label: 'Legendary spells only' },
  multicolored: { icon: '🌈', label: 'Multicolored spells only' },
  commander: { icon: '🎖️', label: 'Commander costs only' },
  activated_abilities: { icon: '🔄', label: 'Activated abilities only' },
  instant_sorcery: { icon: '✨', label: 'Instants/Sorceries only' },
  specific_card: { icon: '🎯', label: 'Specific card only' },
};

interface ManaPoolData {
  white?: number;
  blue?: number;
  black?: number;
  red?: number;
  green?: number;
  colorless?: number;
  /** Restricted mana entries */
  restricted?: RestrictedManaEntry[];
  /** Flag indicating mana doesn't empty at end of phases */
  doesNotEmpty?: boolean;
  /** Source name(s) for the doesn't empty effect */
  noEmptySourceIds?: string[];
}

interface FloatingManaPoolProps {
  manaPool?: ManaPoolData;
  playerId?: string;
  onManaClick?: (color: string, restrictedIndex?: number) => void;
  compact?: boolean;
}

export function FloatingManaPool({ manaPool, playerId, onManaClick, compact = false }: FloatingManaPoolProps) {
  if (!manaPool) return null;
  
  // Calculate total regular mana in pool
  const regularMana = (manaPool.white || 0) + (manaPool.blue || 0) + (manaPool.black || 0) + 
                      (manaPool.red || 0) + (manaPool.green || 0) + (manaPool.colorless || 0);
  
  // Calculate total restricted mana
  const restrictedMana = manaPool.restricted?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
  
  const totalMana = regularMana + restrictedMana;
  
  // Don't render if no floating mana
  if (totalMana === 0) return null;
  
  // Get non-zero regular mana colors
  const regularManaEntries: [string, number][] = [
    ['white', manaPool.white || 0],
    ['blue', manaPool.blue || 0],
    ['black', manaPool.black || 0],
    ['red', manaPool.red || 0],
    ['green', manaPool.green || 0],
    ['colorless', manaPool.colorless || 0],
  ].filter(([_, count]) => count > 0) as [string, number][];
  
  // Sort regular mana by count descending
  regularManaEntries.sort((a, b) => b[1] - a[1]);
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: compact ? '4px 8px' : '8px 12px',
      background: 'linear-gradient(135deg, rgba(30,30,40,0.95), rgba(50,50,70,0.95))',
      border: manaPool.doesNotEmpty ? '2px solid #10b981' : '2px solid #f59e0b',
      borderRadius: 8,
      boxShadow: manaPool.doesNotEmpty 
        ? '0 0 12px rgba(16,185,129,0.4)' 
        : '0 0 12px rgba(245,158,11,0.4)',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        justifyContent: 'space-between',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span style={{ fontSize: compact ? 14 : 16 }}>🔮</span>
          <span style={{
            fontSize: compact ? 11 : 12,
            fontWeight: 'bold',
            color: '#fcd34d',
            whiteSpace: 'nowrap',
          }}>
            Mana Pool
          </span>
          {/* Doesn't empty indicator */}
          {manaPool.doesNotEmpty && (
            <span style={{
              fontSize: compact ? 10 : 11,
              color: '#10b981',
              fontWeight: 'bold',
              marginLeft: 4,
            }} title="Mana doesn't empty from this pool">
              ∞
            </span>
          )}
        </div>
        
        {/* Total count badge */}
        <div style={{
          padding: '2px 8px',
          background: 'rgba(245,158,11,0.3)',
          border: '1px solid rgba(245,158,11,0.5)',
          borderRadius: 10,
          fontSize: compact ? 10 : 11,
          fontWeight: 'bold',
          color: '#fcd34d',
        }}>
          Total: {totalMana}
        </div>
      </div>
      
      {/* Regular mana icons */}
      {regularManaEntries.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
        }}>
          {regularManaEntries.map(([colorName, count]) => {
            const colors = MANA_SYMBOL_COLORS[colorName] || MANA_SYMBOL_COLORS.colorless;
            const symbol = MANA_SYMBOLS[colorName] || '?';
            const amount = count || 0;
            
            // For large amounts, show count badge instead of many icons
            if (amount > 3) {
              return (
                <div
                  key={colorName}
                  onClick={() => onManaClick?.(colorName)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    cursor: onManaClick ? 'pointer' : 'default',
                    padding: '2px 6px',
                    background: colors.bg,
                    border: `2px solid ${colors.border}`,
                    borderRadius: 12,
                    transition: 'transform 0.1s, box-shadow 0.1s',
                  }}
                  title={`${amount} ${colorName} mana - Click to use`}
                  onMouseEnter={(e) => {
                    if (onManaClick) {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 8px rgba(255,255,255,0.5)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                >
                  <span style={{
                    fontWeight: 'bold',
                    fontSize: compact ? 12 : 14,
                    color: colors.text,
                    fontFamily: 'monospace',
                  }}>
                    {symbol}
                  </span>
                  <span style={{
                    fontSize: compact ? 11 : 12,
                    fontWeight: 'bold',
                    color: colors.text,
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: 6,
                    padding: '0 4px',
                    minWidth: 16,
                    textAlign: 'center',
                  }}>
                    ×{amount}
                  </span>
                </div>
              );
            }
            
            // For small amounts, show individual icons
            return Array.from({ length: amount }).map((_, idx) => (
              <div
                key={`${colorName}-${idx}`}
                onClick={() => onManaClick?.(colorName)}
                style={{
                  width: compact ? 22 : 26,
                  height: compact ? 22 : 26,
                  borderRadius: '50%',
                  background: colors.bg,
                  border: `2px solid ${colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: onManaClick ? 'pointer' : 'default',
                  transition: 'transform 0.1s, box-shadow 0.1s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }}
                title={`${colorName} mana - Click to use`}
                onMouseEnter={(e) => {
                  if (onManaClick) {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.15)';
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(255,255,255,0.6)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
                }}
              >
                <span style={{
                  fontWeight: 'bold',
                  fontSize: compact ? 12 : 14,
                  color: colors.text,
                  fontFamily: 'monospace',
                  textShadow: colorName === 'black' ? '0 0 2px #fff' : 'none',
                }}>
                  {symbol}
                </span>
              </div>
            ));
          })}
        </div>
      )}
      
      {/* Restricted mana section */}
      {manaPool.restricted && manaPool.restricted.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          paddingTop: regularManaEntries.length > 0 ? 4 : 0,
          borderTop: regularManaEntries.length > 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
        }}>
          <span style={{
            fontSize: compact ? 9 : 10,
            color: 'rgba(255,255,255,0.6)',
            fontStyle: 'italic',
          }}>
            Restricted Mana:
          </span>
          <div style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
          }}>
            {manaPool.restricted.map((entry, index) => {
              // Use 'type' as the primary color field
              const colorName = entry.type || 'colorless';
              const colors = MANA_SYMBOL_COLORS[colorName] || MANA_SYMBOL_COLORS.colorless;
              const symbol = MANA_SYMBOLS[colorName] || '?';
              const restrictionInfo = RESTRICTION_ICONS[entry.restriction] || { icon: '🔒', label: 'Restricted' };
              
              return (
                <div
                  key={`restricted-${index}`}
                  onClick={() => onManaClick?.(colorName, index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    cursor: onManaClick ? 'pointer' : 'default',
                    padding: '3px 6px',
                    background: `linear-gradient(135deg, ${colors.bg}, rgba(139,92,246,0.3))`,
                    border: `2px solid rgba(139,92,246,0.6)`,
                    borderRadius: 12,
                    transition: 'transform 0.1s, box-shadow 0.1s',
                  }}
                  title={`${entry.amount} ${colorName} mana - ${restrictionInfo.label}${entry.sourceName ? ` (from ${entry.sourceName})` : ''}`}
                  onMouseEnter={(e) => {
                    if (onManaClick) {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 0 8px rgba(139,92,246,0.6)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                >
                  {/* Mana symbol */}
                  <span style={{
                    fontWeight: 'bold',
                    fontSize: compact ? 11 : 13,
                    color: colors.text,
                    fontFamily: 'monospace',
                  }}>
                    {symbol}
                  </span>
                  
                  {/* Amount badge */}
                  {entry.amount > 1 && (
                    <span style={{
                      fontSize: compact ? 10 : 11,
                      fontWeight: 'bold',
                      color: colors.text,
                      background: 'rgba(0,0,0,0.3)',
                      borderRadius: 4,
                      padding: '0 3px',
                    }}>
                      ×{entry.amount}
                    </span>
                  )}
                  
                  {/* Restriction icon */}
                  <span style={{
                    fontSize: compact ? 10 : 12,
                  }} title={restrictionInfo.label}>
                    {restrictionInfo.icon}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default FloatingManaPool;
