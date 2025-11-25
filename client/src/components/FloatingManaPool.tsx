/**
 * FloatingManaPool component - displays the player's current mana pool
 * Shows clickable mana icons when there is floating mana available
 */
import React from 'react';
import type { ManaColor } from '../../../shared/src';

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

interface ManaPoolData {
  white?: number;
  blue?: number;
  black?: number;
  red?: number;
  green?: number;
  colorless?: number;
}

interface FloatingManaPoolProps {
  manaPool?: ManaPoolData;
  playerId?: string;
  onManaClick?: (color: string) => void;
  compact?: boolean;
}

export function FloatingManaPool({ manaPool, playerId, onManaClick, compact = false }: FloatingManaPoolProps) {
  if (!manaPool) return null;
  
  // Calculate total mana in pool
  const totalMana = Object.values(manaPool).reduce((sum, val) => sum + (val || 0), 0);
  
  // Don't render if no floating mana
  if (totalMana === 0) return null;
  
  // Get non-zero mana colors
  const manaEntries = Object.entries(manaPool)
    .filter(([_, count]) => count && count > 0)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0)); // Sort by count descending
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: compact ? '4px 8px' : '8px 12px',
      background: 'linear-gradient(135deg, rgba(30,30,40,0.95), rgba(50,50,70,0.95))',
      border: '2px solid #f59e0b',
      borderRadius: 8,
      boxShadow: '0 0 12px rgba(245,158,11,0.4)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginRight: 4,
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
      </div>
      
      {/* Mana icons */}
      <div style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
      }}>
        {manaEntries.map(([colorName, count]) => {
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
      
      {/* Total count badge */}
      <div style={{
        marginLeft: 4,
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
  );
}

export default FloatingManaPool;
