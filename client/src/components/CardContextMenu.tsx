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

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import { parseActivatedAbilities as parseAbilitiesFull, type ParsedActivatedAbility } from '../utils/activatedAbilityParser';

export interface ActivatedAbilityOption {
  id: string;
  label: string;
  description: string;
  cost?: string;
  requiresTap?: boolean;
  requiresSacrifice?: boolean;
  isManaAbility?: boolean;
  isLoyaltyAbility?: boolean;
  isCrewAbility?: boolean;
  isStationAbility?: boolean;
  crewPower?: number;
  stationThreshold?: number;
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
  onExchangeTextBoxes?: (permanentId: string) => void;
  onIgnoreForAutoPass?: (permanentId: string, cardName: string, imageUrl?: string) => void;
  onUnignoreForAutoPass?: (permanentId: string) => void;
  isIgnoredForAutoPass?: boolean;
  canActivate?: boolean;
  playerId?: string;
}

/**
 * Convert ParsedActivatedAbility to ActivatedAbilityOption for the context menu
 */
function convertToMenuOption(ability: ParsedActivatedAbility): ActivatedAbilityOption {
  return {
    id: ability.id,
    label: ability.label,
    description: ability.description,
    cost: ability.cost,
    requiresTap: ability.requiresTap,
    requiresSacrifice: ability.requiresSacrifice,
    isManaAbility: ability.isManaAbility,
    isLoyaltyAbility: ability.isLoyaltyAbility,
    isCrewAbility: ability.isCrewAbility,
    isStationAbility: ability.isStationAbility,
    crewPower: ability.crewPower,
    stationThreshold: ability.stationThreshold,
  };
}

/**
 * Parse abilities from card oracle text using the comprehensive parser
 */
function parseActivatedAbilities(card: KnownCardRef): ActivatedAbilityOption[] {
  // Use the full ability parser for comprehensive coverage
  const parsed = parseAbilitiesFull(card);
  return parsed.map(convertToMenuOption);
}

/**
 * Get the appropriate icon for an ability based on its type
 */
function getAbilityIcon(ability: ActivatedAbilityOption): string {
  if (ability.isCrewAbility) return '🚗';
  if (ability.isStationAbility) return '🚀';
  if (ability.isManaAbility) return '💎';
  if (ability.requiresSacrifice) return '⚡';
  return '✨';
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
  onExchangeTextBoxes,
  onIgnoreForAutoPass,
  onUnignoreForAutoPass,
  isIgnoredForAutoPass = false,
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
        zIndex: 100000, // Very high to ensure it appears on top of all other elements
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

      {onExchangeTextBoxes && (
        <div
          style={canActivate ? menuItemStyle : disabledStyle}
          onClick={() => {
            if (!canActivate) return;
            onExchangeTextBoxes(permanent.id);
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
          <span style={{ width: 20, textAlign: 'center' }}>🔀</span>
          <span>Exchange text box…</span>
        </div>
      )}

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
                  {getAbilityIcon(ability)}
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
      
      {/* Auto-Pass Section */}
      {(onIgnoreForAutoPass || onUnignoreForAutoPass) && (
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
            Auto-Pass
          </div>
          {isIgnoredForAutoPass ? (
            <div
              style={menuItemStyle}
              onClick={() => {
                onUnignoreForAutoPass?.(permanent.id);
                onClose();
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(34,197,94,0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              <span style={{ width: 20, textAlign: 'center' }}>✅</span>
              <span style={{ color: '#4ade80' }}>Stop Ignoring</span>
            </div>
          ) : (
            <div
              style={menuItemStyle}
              onClick={() => {
                const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
                onIgnoreForAutoPass?.(permanent.id, card?.name || 'Unknown', imageUrl);
                onClose();
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(250,204,21,0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
              title="Ignore this card when checking for Smart Auto-Pass. Useful for cards like Elixir of Immortality when you have no cards in graveyard."
            >
              <span style={{ width: 20, textAlign: 'center' }}>🔇</span>
              <span style={{ color: '#facc15' }}>Ignore for Auto-Pass</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CardContextMenu;
