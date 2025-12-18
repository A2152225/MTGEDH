/**
 * ZoneCardContextMenu.tsx
 * 
 * A unified right-click context menu for cards in any zone:
 * - Hand, Graveyard, Exile, Commander zone, Library (top card if revealed)
 * 
 * Provides options based on the card's type, zone, and abilities:
 * - Cast spell / Play land
 * - Zone-specific abilities (flashback, foretell, etc.)
 * - Ignore for playability checks
 * - Discard (for hand)
 */

import React, { useEffect, useRef, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';

export type ZoneType = 'hand' | 'graveyard' | 'exile' | 'commander' | 'library' | 'battlefield';

export interface ZoneCardContextMenuProps {
  card: KnownCardRef;
  zone: ZoneType;
  x: number;
  y: number;
  onClose: () => void;
  // Action handlers
  onCast?: (cardId: string) => void;
  onPlayLand?: (cardId: string) => void;
  onDiscard?: (cardId: string) => void;
  onActivateAbility?: (cardId: string, abilityId: string) => void;
  // Ignore for playability checks
  onIgnoreForPlayability?: (cardId: string, cardName: string, zone: ZoneType, imageUrl?: string) => void;
  onUnignoreForPlayability?: (cardId: string) => void;
  isIgnoredForPlayability?: boolean;
  // State
  canCast?: boolean;
  canPlayLand?: boolean;
  canDiscard?: boolean;
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

/**
 * Parse zone-specific abilities from a card
 */
function parseZoneAbilities(card: KnownCardRef, zone: ZoneType): Array<{ id: string; label: string; description: string; cost?: string }> {
  const abilities: Array<{ id: string; label: string; description: string; cost?: string }> = [];
  const oracleText = (card.oracle_text || '').toLowerCase();

  if (zone === 'graveyard') {
    // Flashback
    if (oracleText.includes('flashback')) {
      const match = card.oracle_text?.match(/flashback[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      abilities.push({
        id: 'flashback',
        label: 'Flashback',
        description: `Cast from graveyard`,
        cost: match ? match[1] : card.mana_cost,
      });
    }
    // Unearth
    if (oracleText.includes('unearth')) {
      const match = card.oracle_text?.match(/unearth\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      abilities.push({
        id: 'unearth',
        label: 'Unearth',
        description: `Return to battlefield`,
        cost: match ? match[1] : undefined,
      });
    }
    // Escape
    if (oracleText.includes('escape')) {
      const match = card.oracle_text?.match(/escape[—\-]([^(.\n]+)/i);
      abilities.push({
        id: 'escape',
        label: 'Escape',
        description: `Cast from graveyard`,
        cost: match ? match[1].trim() : undefined,
      });
    }
    // Embalm
    if (oracleText.includes('embalm')) {
      const match = card.oracle_text?.match(/embalm\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      abilities.push({
        id: 'embalm',
        label: 'Embalm',
        description: `Create token copy`,
        cost: match ? match[1] : undefined,
      });
    }
    // Eternalize
    if (oracleText.includes('eternalize')) {
      const match = card.oracle_text?.match(/eternalize\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      abilities.push({
        id: 'eternalize',
        label: 'Eternalize',
        description: `Create 4/4 token copy`,
        cost: match ? match[1] : undefined,
      });
    }
    // Jump-start
    if (oracleText.includes('jump-start')) {
      abilities.push({
        id: 'jump-start',
        label: 'Jump-start',
        description: `Cast from graveyard, discard a card`,
        cost: card.mana_cost,
      });
    }
    // Retrace
    if (oracleText.includes('retrace')) {
      abilities.push({
        id: 'retrace',
        label: 'Retrace',
        description: `Cast from graveyard, discard a land`,
        cost: card.mana_cost,
      });
    }
    // Disturb
    if (oracleText.includes('disturb')) {
      const match = card.oracle_text?.match(/disturb\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      abilities.push({
        id: 'disturb',
        label: 'Disturb',
        description: `Cast transformed from graveyard`,
        cost: match ? match[1] : undefined,
      });
    }
  }

  if (zone === 'exile') {
    // Foretell
    if (oracleText.includes('foretell')) {
      const match = card.oracle_text?.match(/foretell[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      abilities.push({
        id: 'foretell-cast',
        label: 'Cast (Foretold)',
        description: `Cast from exile`,
        cost: match ? match[1] : card.mana_cost,
      });
    }
    // Suspend
    if (oracleText.includes('suspend')) {
      abilities.push({
        id: 'suspend-status',
        label: 'Suspended',
        description: `Waiting for time counters`,
      });
    }
    // Plot
    if (oracleText.includes('plot')) {
      abilities.push({
        id: 'plot-cast',
        label: 'Cast (Plotted)',
        description: `Cast from exile for free`,
      });
    }
    // Adventure (can cast creature from exile after adventure)
    if ((card as any).layout === 'adventure' || oracleText.includes('adventure')) {
      abilities.push({
        id: 'adventure-creature',
        label: 'Cast Creature',
        description: `Cast creature half from exile`,
        cost: card.mana_cost,
      });
    }
    // Generic "play from exile" effects
    if ((oracleText.includes('you may play') || oracleText.includes('you may cast')) &&
        (oracleText.includes('from exile') || oracleText.includes('this turn'))) {
      abilities.push({
        id: 'play-from-exile',
        label: 'Play',
        description: `May play from exile`,
      });
    }
  }

  if (zone === 'hand') {
    // Foretell (pay {2} to exile face-down)
    if (oracleText.includes('foretell')) {
      abilities.push({
        id: 'foretell',
        label: 'Foretell',
        description: `Exile face-down for {2}`,
        cost: '{2}',
      });
    }
    // Kicker
    if (oracleText.includes('kicker')) {
      abilities.push({
        id: 'cast-kicked',
        label: 'Cast with Kicker',
        description: `Cast with additional cost`,
      });
    }
    // Buyback
    if (oracleText.includes('buyback')) {
      abilities.push({
        id: 'cast-buyback',
        label: 'Cast with Buyback',
        description: `Cast and return to hand`,
      });
    }
  }

  return abilities;
}

export function ZoneCardContextMenu({
  card,
  zone,
  x,
  y,
  onClose,
  onCast,
  onPlayLand,
  onDiscard,
  onActivateAbility,
  onIgnoreForPlayability,
  onUnignoreForPlayability,
  isIgnoredForPlayability = false,
  canCast = true,
  canPlayLand = true,
  canDiscard = true,
  reasonCannotCast,
  reasonCannotPlayLand,
  costAdjustment,
}: ZoneCardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  const name = card?.name || 'Card';
  const typeLine = (card?.type_line || '').toLowerCase();
  const isLand = /\bland\b/i.test(typeLine);
  const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;

  // Parse zone-specific abilities
  const zoneAbilities = parseZoneAbilities(card, zone);

  // Adjust position to keep menu on screen
  useEffect(() => {
    const adjustPosition = () => {
      if (!menuRef.current) return;
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        requestAnimationFrame(adjustPosition);
        return;
      }
      const newX = Math.min(x, window.innerWidth - rect.width - 10);
      const newY = Math.min(y, window.innerHeight - rect.height - 10);
      if (newX !== x || newY !== y) {
        setPosition({ x: Math.max(10, newX), y: Math.max(10, newY) });
      }
    };
    requestAnimationFrame(adjustPosition);
  }, [x, y]);

  // Close on click outside or escape
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
    color: '#e5e7eb',
  };

  const disabledStyle: React.CSSProperties = {
    ...menuItemStyle,
    opacity: 0.5,
    cursor: 'not-allowed',
    color: '#888',
  };

  const handleHover = (e: React.MouseEvent<HTMLDivElement>, isEnabled: boolean) => {
    if (isEnabled) {
      e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)';
    }
  };

  const handleHoverOut = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent';
  };

  // Get zone display label
  const getZoneLabel = () => {
    switch (zone) {
      case 'hand': return '🖐️ Hand';
      case 'graveyard': return '⚰️ Graveyard';
      case 'exile': return '🌀 Exile';
      case 'commander': return '👑 Command Zone';
      case 'library': return '📚 Library';
      default: return zone;
    }
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
        minWidth: 220,
        maxWidth: 300,
        zIndex: 10000,
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
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
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
          {getZoneLabel()}
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
          </div>
        )}
      </div>

      {/* Menu items */}
      <div style={{ padding: '4px 0' }}>
        {/* Play Land (for lands in playable zones) */}
        {isLand && (zone === 'hand' || zone === 'graveyard' || zone === 'exile') && onPlayLand && (
          <div
            style={canPlayLand && !reasonCannotPlayLand ? menuItemStyle : disabledStyle}
            onClick={() => {
              if (canPlayLand && !reasonCannotPlayLand) {
                onPlayLand(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => handleHover(e, canPlayLand && !reasonCannotPlayLand)}
            onMouseLeave={handleHoverOut}
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

        {/* Cast Spell (for non-lands) */}
        {!isLand && (zone === 'hand' || zone === 'commander') && onCast && (
          <div
            style={canCast && !reasonCannotCast ? menuItemStyle : disabledStyle}
            onClick={() => {
              if (canCast && !reasonCannotCast) {
                onCast(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => handleHover(e, canCast && !reasonCannotCast)}
            onMouseLeave={handleHoverOut}
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

        {/* Zone-specific abilities */}
        {zoneAbilities.length > 0 && (
          <>
            <div style={{ height: 1, backgroundColor: '#444', margin: '4px 0' }} />
            {zoneAbilities.map((ability) => (
              <div
                key={ability.id}
                style={menuItemStyle}
                onClick={() => {
                  if (onActivateAbility) {
                    onActivateAbility(card.id, ability.id);
                    onClose();
                  }
                }}
                onMouseEnter={(e) => handleHover(e, true)}
                onMouseLeave={handleHoverOut}
              >
                <span>⚡</span>
                <span>{ability.label}</span>
                {ability.cost && (
                  <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>
                    {ability.cost}
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {/* Discard (for hand cards) */}
        {zone === 'hand' && canDiscard && onDiscard && (
          <>
            <div style={{ height: 1, backgroundColor: '#444', margin: '4px 0' }} />
            <div
              style={menuItemStyle}
              onClick={() => {
                onDiscard(card.id);
                onClose();
              }}
              onMouseEnter={(e) => handleHover(e, true)}
              onMouseLeave={handleHoverOut}
            >
              <span>🗑️</span>
              <span>Discard</span>
            </div>
          </>
        )}

        {/* Separator before ignore option */}
        <div style={{ height: 1, backgroundColor: '#444', margin: '4px 0' }} />

        {/* Ignore/Unignore for playability checks */}
        {isIgnoredForPlayability ? (
          <div
            style={{
              ...menuItemStyle,
              color: '#fcd34d',
            }}
            onClick={() => {
              if (onUnignoreForPlayability) {
                onUnignoreForPlayability(card.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => handleHover(e, true)}
            onMouseLeave={handleHoverOut}
          >
            <span>🔔</span>
            <span>Stop Ignoring</span>
            <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 'auto' }}>
              (Enable checks)
            </span>
          </div>
        ) : (
          <div
            style={menuItemStyle}
            onClick={() => {
              if (onIgnoreForPlayability) {
                onIgnoreForPlayability(card.id, name, zone, imageUrl);
                onClose();
              }
            }}
            onMouseEnter={(e) => handleHover(e, true)}
            onMouseLeave={handleHoverOut}
            title="Ignore this card for Smart Auto-Pass and playability checks"
          >
            <span>🔇</span>
            <span>Ignore for Auto-Pass</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ZoneCardContextMenu;
