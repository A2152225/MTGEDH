// client/src/components/ActivatedAbilityButtons.tsx
// Displays clickable buttons for activated abilities on card overlays

import React, { useMemo, useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import {
  parseActivatedAbilities,
  canActivateTapAbility,
  getAbilityIcon,
  formatAbilityCost,
  type ParsedActivatedAbility,
  type ActivationContext,
} from '../utils/activatedAbilityParser';

export interface ActivatedAbilityButtonsProps {
  perm: BattlefieldPermanent;
  tileWidth: number;
  // Activation context
  hasPriority: boolean;
  isOwnTurn: boolean;
  isMainPhase: boolean;
  stackEmpty: boolean;
  // External state that affects activation
  hasThousandYearElixirEffect?: boolean;
  // Callbacks
  onActivateAbility?: (permanentId: string, abilityId: string, ability: ParsedActivatedAbility) => void;
  // Display options
  showOnHover?: boolean;
  maxVisible?: number;
  position?: 'left' | 'bottom';
}

/**
 * Check if a creature has haste (from granted abilities or oracle text)
 */
function hasHaste(perm: BattlefieldPermanent): boolean {
  const abilities = perm.grantedAbilities || [];
  if (abilities.some(a => a.toLowerCase() === 'haste')) {
    return true;
  }
  
  const kc = perm.card as KnownCardRef;
  const oracleText = (kc?.oracle_text || '').toLowerCase();
  if (oracleText.includes('haste')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent is a creature (for summoning sickness)
 */
function isCreature(perm: BattlefieldPermanent): boolean {
  const kc = perm.card as KnownCardRef;
  const typeLine = (kc?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

/**
 * Get current loyalty counters for planeswalkers
 */
function getLoyaltyCounters(perm: BattlefieldPermanent): number | undefined {
  if (perm.loyalty !== undefined) {
    return perm.loyalty;
  }
  if (perm.counters?.['loyalty'] !== undefined) {
    return perm.counters['loyalty'];
  }
  return undefined;
}

export function ActivatedAbilityButtons({
  perm,
  tileWidth,
  hasPriority,
  isOwnTurn,
  isMainPhase,
  stackEmpty,
  hasThousandYearElixirEffect = false,
  onActivateAbility,
  showOnHover = true,
  maxVisible = 3,
  position = 'left',
}: ActivatedAbilityButtonsProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  
  const kc = perm.card as KnownCardRef;
  const scale = tileWidth / 110;
  
  // Parse abilities from the card
  const abilities = useMemo(() => {
    if (!kc) return [];
    return parseActivatedAbilities(kc);
  }, [kc]);
  
  // Build activation context
  const context: ActivationContext = useMemo(() => ({
    isTapped: !!perm.tapped,
    hasSummoningSickness: !!perm.summoningSickness && isCreature(perm),
    hasHaste: hasHaste(perm),
    hasThousandYearElixirEffect,
    loyaltyCounters: getLoyaltyCounters(perm),
    controllerHasPriority: hasPriority,
    isMainPhase,
    isOwnTurn,
    stackEmpty,
  }), [perm, hasPriority, isMainPhase, isOwnTurn, stackEmpty, hasThousandYearElixirEffect]);
  
  // Filter and annotate abilities with activation status
  const annotatedAbilities = useMemo(() => {
    return abilities.map(ability => {
      // Check if ability can be activated
      const tapCheck = canActivateTapAbility(
        ability.requiresTap,
        context,
        ability.isManaAbility
      );
      
      let canActivate = tapCheck.canActivate;
      let reason = tapCheck.reason;
      
      // Check loyalty ability restrictions
      if (ability.isLoyaltyAbility) {
        if (!context.isMainPhase) {
          canActivate = false;
          reason = 'Only during main phase';
        } else if (!context.isOwnTurn) {
          canActivate = false;
          reason = 'Only on your turn';
        } else if (!context.stackEmpty) {
          canActivate = false;
          reason = 'Stack must be empty';
        } else if (ability.loyaltyCost !== undefined && context.loyaltyCounters !== undefined) {
          if (ability.loyaltyCost < 0 && context.loyaltyCounters < Math.abs(ability.loyaltyCost)) {
            canActivate = false;
            reason = 'Not enough loyalty';
          }
        }
      }
      
      // Check sorcery timing restriction
      if (ability.timingRestriction === 'sorcery') {
        if (!context.isMainPhase || !context.isOwnTurn || !context.stackEmpty) {
          canActivate = false;
          reason = 'Sorcery timing required';
        }
      }
      
      // Need priority for non-mana abilities
      if (!ability.isManaAbility && !context.controllerHasPriority) {
        canActivate = false;
        reason = 'No priority';
      }
      
      return {
        ability,
        canActivate,
        reason,
      };
    });
  }, [abilities, context]);
  
  // Don't show anything if no abilities
  if (annotatedAbilities.length === 0) {
    return null;
  }
  
  // Show/hide based on hover if showOnHover is true
  const shouldShow = showOnHover ? hovered : true;
  const visibleAbilities = expanded ? annotatedAbilities : annotatedAbilities.slice(0, maxVisible);
  const hasMore = annotatedAbilities.length > maxVisible;
  
  const handleActivate = (ability: ParsedActivatedAbility) => {
    if (onActivateAbility) {
      onActivateAbility(perm.id, ability.id, ability);
    }
  };
  
  // Positioning styles
  const containerStyle: React.CSSProperties = position === 'left' ? {
    position: 'absolute',
    left: Math.round(-4 * scale),
    top: '50%',
    transform: 'translateY(-50%) translateX(-100%)',
    display: 'flex',
    flexDirection: 'column',
    gap: Math.round(3 * scale),
    zIndex: 20,
    opacity: shouldShow ? 1 : 0,
    transition: 'opacity 0.15s ease',
    pointerEvents: shouldShow ? 'auto' : 'none',
  } : {
    position: 'absolute',
    left: '50%',
    bottom: Math.round(-4 * scale),
    transform: 'translateX(-50%) translateY(100%)',
    display: 'flex',
    flexDirection: 'row',
    gap: Math.round(3 * scale),
    zIndex: 20,
    opacity: shouldShow ? 1 : 0,
    transition: 'opacity 0.15s ease',
    pointerEvents: shouldShow ? 'auto' : 'none',
  };
  
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setExpanded(false);
      }}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      {/* Hover zone to trigger ability display */}
      <div
        style={{
          position: 'absolute',
          left: position === 'left' ? -Math.round(40 * scale) : 0,
          top: 0,
          width: position === 'left' ? Math.round(40 * scale) : '100%',
          height: '100%',
          pointerEvents: showOnHover ? 'auto' : 'none',
        }}
        onMouseEnter={() => setHovered(true)}
      />
      
      {/* Ability buttons container */}
      <div style={containerStyle}>
        {visibleAbilities.map(({ ability, canActivate, reason }) => {
          const icon = getAbilityIcon(ability);
          const costText = formatAbilityCost(ability);
          
          // Color based on ability type
          let bgColor = 'rgba(30, 41, 59, 0.95)';
          let borderColor = 'rgba(100, 116, 139, 0.6)';
          
          if (ability.isManaAbility) {
            bgColor = 'rgba(16, 185, 129, 0.9)';
            borderColor = 'rgba(52, 211, 153, 0.8)';
          } else if (ability.isFetchAbility) {
            bgColor = 'rgba(139, 92, 246, 0.9)';
            borderColor = 'rgba(167, 139, 250, 0.8)';
          } else if (ability.isLoyaltyAbility) {
            bgColor = 'rgba(168, 85, 247, 0.9)';
            borderColor = 'rgba(192, 132, 252, 0.8)';
          } else if (ability.requiresSacrifice) {
            bgColor = 'rgba(239, 68, 68, 0.9)';
            borderColor = 'rgba(252, 165, 165, 0.8)';
          }
          
          if (!canActivate) {
            bgColor = 'rgba(55, 65, 81, 0.8)';
            borderColor = 'rgba(75, 85, 99, 0.6)';
          }
          
          return (
            <button
              key={ability.id}
              onClick={(e) => {
                e.stopPropagation();
                if (canActivate) {
                  handleActivate(ability);
                }
              }}
              disabled={!canActivate}
              title={canActivate 
                ? `${ability.label}\n${ability.description}\nCost: ${costText}`
                : `${ability.label}\n${reason || 'Cannot activate'}`
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: Math.round(4 * scale),
                padding: `${Math.round(4 * scale)}px ${Math.round(8 * scale)}px`,
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: Math.round(6 * scale),
                color: canActivate ? '#fff' : '#9ca3af',
                fontSize: Math.round(10 * scale),
                fontWeight: 500,
                cursor: canActivate ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
                boxShadow: canActivate 
                  ? '0 2px 8px rgba(0,0,0,0.3)' 
                  : 'none',
                transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                opacity: canActivate ? 1 : 0.6,
                pointerEvents: 'auto',
              }}
              onMouseOver={(e) => {
                if (canActivate) {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = canActivate ? '0 2px 8px rgba(0,0,0,0.3)' : 'none';
              }}
            >
              <span style={{ fontSize: Math.round(12 * scale) }}>{icon}</span>
              <span style={{ 
                maxWidth: Math.round(80 * scale),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {ability.label}
              </span>
            </button>
          );
        })}
        
        {/* Show more button */}
        {hasMore && !expanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: `${Math.round(3 * scale)}px ${Math.round(6 * scale)}px`,
              background: 'rgba(30, 41, 59, 0.9)',
              border: '1px solid rgba(100, 116, 139, 0.6)',
              borderRadius: Math.round(4 * scale),
              color: '#94a3b8',
              fontSize: Math.round(9 * scale),
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
            title={`Show ${annotatedAbilities.length - maxVisible} more abilities`}
          >
            +{annotatedAbilities.length - maxVisible} more
          </button>
        )}
      </div>
    </div>
  );
}

export default ActivatedAbilityButtons;
