/**
 * CardContextMenu.tsx
 * 
 * A right-click context menu for cards on the battlefield.
 * Provides options based on the card's abilities:
 * - Tap/Untap
 * - Activate abilities (mana, fetch land, etc.)
 * - Add/remove counters
 * - View card details
 */

import React, { useEffect, useRef, useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';

export interface ActivatedAbilityOption {
  id: string;
  label: string;
  description: string;
  cost?: string;
  requiresTap?: boolean;
  requiresSacrifice?: boolean;
  isManaAbility?: boolean;
}

export interface CardContextMenuProps {
  permanent: BattlefieldPermanent;
  x: number;
  y: number;
  onClose: () => void;
  onTap?: (permanentId: string) => void;
  onUntap?: (permanentId: string) => void;
  onActivateAbility?: (permanentId: string, abilityId: string) => void;
  onAddCounter?: (permanentId: string, counterType: string, amount: number) => void;
  onSacrifice?: (permanentId: string) => void;
  onRemove?: (permanentId: string) => void;
  canActivate?: boolean;
  playerId?: string;
}

/**
 * Parse abilities from card oracle text
 */
function parseActivatedAbilities(card: KnownCardRef): ActivatedAbilityOption[] {
  const abilities: ActivatedAbilityOption[] = [];
  const oracleText = card.oracle_text || '';
  const typeLine = (card.type_line || '').toLowerCase();
  const name = card.name || '';
  
  // Basic land mana abilities
  if (typeLine.includes('plains')) {
    abilities.push({
      id: 'tap-mana-w',
      label: 'Tap for {W}',
      description: 'Add one white mana',
      cost: '{T}',
      requiresTap: true,
      isManaAbility: true,
    });
  }
  if (typeLine.includes('island')) {
    abilities.push({
      id: 'tap-mana-u',
      label: 'Tap for {U}',
      description: 'Add one blue mana',
      cost: '{T}',
      requiresTap: true,
      isManaAbility: true,
    });
  }
  if (typeLine.includes('swamp')) {
    abilities.push({
      id: 'tap-mana-b',
      label: 'Tap for {B}',
      description: 'Add one black mana',
      cost: '{T}',
      requiresTap: true,
      isManaAbility: true,
    });
  }
  if (typeLine.includes('mountain')) {
    abilities.push({
      id: 'tap-mana-r',
      label: 'Tap for {R}',
      description: 'Add one red mana',
      cost: '{T}',
      requiresTap: true,
      isManaAbility: true,
    });
  }
  if (typeLine.includes('forest')) {
    abilities.push({
      id: 'tap-mana-g',
      label: 'Tap for {G}',
      description: 'Add one green mana',
      cost: '{T}',
      requiresTap: true,
      isManaAbility: true,
    });
  }
  
  // Detect fetch land abilities
  const lowerOracle = oracleText.toLowerCase();
  if (lowerOracle.includes('sacrifice') && lowerOracle.includes('search')) {
    // Common fetch land patterns
    const isTrueFetch = lowerOracle.includes('pay 1 life');
    
    // Determine what land types it can fetch
    let fetchDescription = 'Search your library for a land';
    
    // Try to extract the land type from the oracle text
    // Match patterns like "search your library for a Forest or Plains card"
    // or "search your library for a basic land card"
    const landTypeMatch = oracleText.match(/search your library for (?:a|an) ((?:basic )?(?:(?:Forest|Plains|Island|Mountain|Swamp)(?: or (?:Forest|Plains|Island|Mountain|Swamp))*|land)) card/i);
    if (landTypeMatch) {
      fetchDescription = `Search for: ${landTypeMatch[1]}`;
    }
    
    abilities.push({
      id: 'fetch-land',
      label: isTrueFetch ? 'Fetch Land (pay 1 life)' : 'Fetch Land',
      description: fetchDescription,
      cost: isTrueFetch ? '{T}, Pay 1 life, Sacrifice' : '{T}, Sacrifice',
      requiresTap: true,
      requiresSacrifice: true,
    });
  }
  
  // Detect mana abilities from oracle text
  if (!typeLine.includes('land') || !abilities.some(a => a.isManaAbility)) {
    // Look for "{T}: Add" patterns for mana abilities
    const manaMatch = oracleText.match(/\{T\}:\s*Add\s+(\{[^}]+\}(?:\s*or\s*\{[^}]+\})*)/i);
    if (manaMatch) {
      abilities.push({
        id: 'tap-mana',
        label: `Tap for mana`,
        description: `Add ${manaMatch[1]}`,
        cost: '{T}',
        requiresTap: true,
        isManaAbility: true,
      });
    }
    
    // Any color mana - check for common patterns (case-insensitive since lowerOracle is already lowercase)
    if (lowerOracle.includes('add one mana of any color') || 
        lowerOracle.includes('mana of any color') ||
        lowerOracle.includes('add {w}{u}{b}{r}{g}') || 
        lowerOracle.includes('any type of mana')) {
      abilities.push({
        id: 'tap-mana-any',
        label: 'Tap for any color',
        description: 'Add one mana of any color',
        cost: '{T}',
        requiresTap: true,
        isManaAbility: true,
      });
    }
  }
  
  return abilities;
}

export function CardContextMenu({
  permanent,
  x,
  y,
  onClose,
  onTap,
  onUntap,
  onActivateAbility,
  onAddCounter,
  onSacrifice,
  onRemove,
  canActivate = true,
  playerId,
}: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  
  const card = permanent.card as KnownCardRef;
  const name = card?.name || permanent.id;
  const isTapped = !!permanent.tapped;
  
  // Parse activated abilities from card
  const abilities = card ? parseActivatedAbilities(card) : [];
  
  // Adjust position to keep menu on screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      
      let newX = x;
      let newY = y;
      
      if (x + rect.width > viewportW - 10) {
        newX = viewportW - rect.width - 10;
      }
      if (y + rect.height > viewportH - 10) {
        newY = viewportH - rect.height - 10;
      }
      
      if (newX !== x || newY !== y) {
        setPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);
  
  // Close on outside click or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);
  
  const menuItemStyle: React.CSSProperties = {
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    transition: 'background 0.1s',
  };
  
  const disabledStyle: React.CSSProperties = {
    ...menuItemStyle,
    opacity: 0.5,
    cursor: 'not-allowed',
  };
  
  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        backgroundColor: '#1a1a2e',
        border: '1px solid #4a4a6a',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        minWidth: 200,
        maxWidth: 300,
        zIndex: 10000,
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Header with card name */}
      <div
        style={{
          padding: '10px 12px',
          backgroundColor: '#252540',
          borderBottom: '1px solid #4a4a6a',
          fontWeight: 600,
          fontSize: 14,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
        {isTapped && <span style={{ marginLeft: 8, color: '#888', fontSize: 11 }}>(tapped)</span>}
      </div>
      
      {/* Tap/Untap */}
      <div
        style={canActivate ? menuItemStyle : disabledStyle}
        onClick={() => {
          if (!canActivate) return;
          if (isTapped) {
            onUntap?.(permanent.id);
          } else {
            onTap?.(permanent.id);
          }
          onClose();
        }}
        onMouseEnter={(e) => {
          if (canActivate) {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }}
      >
        <span style={{ width: 20, textAlign: 'center' }}>{isTapped ? '🔄' : '↪️'}</span>
        <span>{isTapped ? 'Untap' : 'Tap'}</span>
      </div>
      
      {/* Activated Abilities */}
      {abilities.length > 0 && (
        <>
          <div
            style={{
              padding: '6px 12px',
              backgroundColor: '#1e1e35',
              color: '#888',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Abilities
          </div>
          {abilities.map((ability) => {
            const canUse = canActivate && (!ability.requiresTap || !isTapped);
            
            return (
              <div
                key={ability.id}
                style={canUse ? menuItemStyle : disabledStyle}
                onClick={() => {
                  if (!canUse) return;
                  onActivateAbility?.(permanent.id, ability.id);
                  onClose();
                }}
                onMouseEnter={(e) => {
                  if (canUse) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }}
                title={ability.description}
              >
                <span style={{ width: 20, textAlign: 'center' }}>
                  {ability.isManaAbility ? '💎' : ability.requiresSacrifice ? '⚡' : '✨'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{ability.label}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    {ability.cost && <span style={{ marginRight: 8 }}>{ability.cost}</span>}
                    {ability.description}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
      
      {/* Counter Actions */}
      <div
        style={{
          padding: '6px 12px',
          backgroundColor: '#1e1e35',
          color: '#888',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Counters
      </div>
      <div
        style={{ ...menuItemStyle, justifyContent: 'space-between' }}
      >
        <span>+1/+1 Counter</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => {
              onAddCounter?.(permanent.id, '+1/+1', 1);
              onClose();
            }}
            style={{
              padding: '2px 8px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #4a4a6a',
              backgroundColor: '#2a2a4a',
              color: '#8f8',
              cursor: 'pointer',
            }}
          >
            +1
          </button>
          <button
            onClick={() => {
              onAddCounter?.(permanent.id, '+1/+1', -1);
              onClose();
            }}
            style={{
              padding: '2px 8px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #4a4a6a',
              backgroundColor: '#2a2a4a',
              color: '#f88',
              cursor: 'pointer',
            }}
          >
            -1
          </button>
        </div>
      </div>
      
      {/* Sacrifice / Remove */}
      <div
        style={{
          padding: '6px 12px',
          backgroundColor: '#1e1e35',
          color: '#888',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Actions
      </div>
      {onSacrifice && (
        <div
          style={canActivate ? menuItemStyle : disabledStyle}
          onClick={() => {
            if (!canActivate) return;
            onSacrifice(permanent.id);
            onClose();
          }}
          onMouseEnter={(e) => {
            if (canActivate) {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239,68,68,0.2)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          <span style={{ width: 20, textAlign: 'center' }}>💀</span>
          <span style={{ color: '#f88' }}>Sacrifice</span>
        </div>
      )}
      {onRemove && (
        <div
          style={menuItemStyle}
          onClick={() => {
            onRemove(permanent.id);
            onClose();
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239,68,68,0.2)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          <span style={{ width: 20, textAlign: 'center' }}>❌</span>
          <span style={{ color: '#f88' }}>Remove from battlefield</span>
        </div>
      )}
    </div>
  );
}

export default CardContextMenu;
