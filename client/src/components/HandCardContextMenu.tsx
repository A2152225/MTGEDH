/**
 * HandCardContextMenu.tsx
 * 
 * A right-click context menu for cards in hand.
 * Provides options based on the card's type and abilities:
 * - Cast spell (with alternate cost options if available)
 * - Play land (if it's a land)
 * - Discard card
 * - Foretell (if the card can be foretold)
 * - View card details
 */

import React, { useEffect, useRef, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';

export interface HandCardContextMenuProps {
  card: KnownCardRef;
  x: number;
  y: number;
  onClose: () => void;
  onCast?: (cardId: string) => void;
  onPlayLand?: (cardId: string) => void;
  onDiscard?: (cardId: string) => void;
  onForetell?: (cardId: string) => void;
  onCastWithKicker?: (cardId: string) => void;
  onCastWithBuyback?: (cardId: string) => void;
  canCast?: boolean;
  canPlayLand?: boolean;
  canDiscard?: boolean;
  canForetell?: boolean;
  reasonCannotCast?: string | null;
  reasonCannotPlayLand?: string | null;
  costAdjustment?: {
    originalCost: string;
    adjustedCost: string;
    adjustment: number;
    sources: string[];
    isIncrease?: boolean;
  };
}

export function HandCardContextMenu({
  card,
  x,
  y,
  onClose,
  onCast,
  onPlayLand,
  onDiscard,
  onForetell,
  onCastWithKicker,
  onCastWithBuyback,
  canCast = true,
  canPlayLand = true,
  canDiscard = true,
  canForetell = false,
  reasonCannotCast,
  reasonCannotPlayLand,
  costAdjustment,
}: HandCardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  
  const name = card?.name || 'Card';
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const isLand = /\bland\b/i.test(typeLine);
  
  // Check for special casting modes
  const hasKicker = oracleText.includes('kicker');
  const hasBuyback = oracleText.includes('buyback');
  const hasForetell = oracleText.includes('foretell');
  
  // Adjust position to keep menu on screen
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const newX = Math.min(x, window.innerWidth - rect.width - 10);
    const newY = Math.min(y, window.innerHeight - rect.height - 10);
    if (newX !== x || newY !== y) {
      setPosition({ x: Math.max(10, newX), y: Math.max(10, newY) });
    }
  }, [x, y]);
  
  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);
  
  const menuItemStyle: React.CSSProperties = {
    padding: '8px 16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    transition: 'background 0.15s',
  };
  
  const disabledStyle: React.CSSProperties = {
    ...menuItemStyle,
    opacity: 0.5,
    cursor: 'not-allowed',
    color: '#888',
  };
  
  const hoverStyle = {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  };
  
  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        backgroundColor: '#1e1e2e',
        border: '1px solid #444',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        minWidth: 200,
        zIndex: 10000,
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header with card name */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #444',
          fontWeight: 600,
          color: '#fff',
          fontSize: 14,
          background: 'linear-gradient(to bottom, rgba(99,102,241,0.2), transparent)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📜</span>
          <span>{name}</span>
        </div>
        {costAdjustment && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: costAdjustment.isIncrease ? '#f87171' : '#4ade80',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>Cost:</span>
            <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
              {costAdjustment.originalCost}
            </span>
            <span>{costAdjustment.isIncrease ? '⬆' : '→'}</span>
            <span>{costAdjustment.adjustedCost}</span>
            <span style={{ opacity: 0.7 }}>({costAdjustment.sources.join(', ')})</span>
          </div>
        )}
      </div>
      
      {/* Menu items */}
      <div style={{ padding: '4px 0' }}>
        {/* Play Land (only for lands) */}
        {isLand && (
          <div
            style={canPlayLand && !reasonCannotPlayLand ? menuItemStyle : disabledStyle}
            onClick={() => {
              if (canPlayLand && !reasonCannotPlayLand && onPlayLand) {
                onPlayLand(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => {
              if (canPlayLand && !reasonCannotPlayLand) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title={reasonCannotPlayLand || undefined}
          >
            <span>🏔️</span>
            <span>Play Land</span>
            {reasonCannotPlayLand && (
              <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 'auto' }}>
                ({reasonCannotPlayLand})
              </span>
            )}
          </div>
        )}
        
        {/* Cast Spell (only for non-lands) */}
        {!isLand && (
          <div
            style={canCast && !reasonCannotCast ? menuItemStyle : disabledStyle}
            onClick={() => {
              if (canCast && !reasonCannotCast && onCast) {
                onCast(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => {
              if (canCast && !reasonCannotCast) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title={reasonCannotCast || undefined}
          >
            <span>✨</span>
            <span>Cast Spell</span>
            {card.mana_cost && (
              <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>
                {costAdjustment?.adjustedCost || card.mana_cost}
              </span>
            )}
          </div>
        )}
        
        {/* Cast with Kicker (if available) */}
        {!isLand && hasKicker && onCastWithKicker && (
          <div
            style={canCast && !reasonCannotCast ? menuItemStyle : disabledStyle}
            onClick={() => {
              if (canCast && !reasonCannotCast && onCastWithKicker) {
                onCastWithKicker(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => {
              if (canCast && !reasonCannotCast) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span>🦶</span>
            <span>Cast with Kicker</span>
          </div>
        )}
        
        {/* Cast with Buyback (if available) */}
        {!isLand && hasBuyback && onCastWithBuyback && (
          <div
            style={canCast && !reasonCannotCast ? menuItemStyle : disabledStyle}
            onClick={() => {
              if (canCast && !reasonCannotCast && onCastWithBuyback) {
                onCastWithBuyback(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => {
              if (canCast && !reasonCannotCast) {
                Object.assign(e.currentTarget.style, hoverStyle);
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span>♻️</span>
            <span>Cast with Buyback</span>
          </div>
        )}
        
        {/* Foretell (if available) */}
        {hasForetell && canForetell && onForetell && (
          <div
            style={menuItemStyle}
            onClick={() => {
              if (onForetell) {
                onForetell(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span>🔮</span>
            <span>Foretell ({'{2}'})</span>
          </div>
        )}
        
        {/* Separator */}
        <div style={{ height: 1, backgroundColor: '#444', margin: '4px 0' }} />
        
        {/* Discard Card */}
        {canDiscard && onDiscard && (
          <div
            style={menuItemStyle}
            onClick={() => {
              if (onDiscard) {
                onDiscard(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, hoverStyle)}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span>🗑️</span>
            <span>Discard</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default HandCardContextMenu;
