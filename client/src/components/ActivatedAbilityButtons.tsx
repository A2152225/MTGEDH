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
import { KeywordHighlighter } from './KeywordHighlighter';
import { XValueSelectionModal } from './XValueSelectionModal';

// Color constants for ability button styling
const COLORS = {
  // Ability type colors
  mana: {
    bg: 'rgba(16, 185, 129, 0.9)',
    border: 'rgba(52, 211, 153, 0.8)',
    accent: '#10b981',
  },
  fetch: {
    bg: 'rgba(139, 92, 246, 0.9)',
    border: 'rgba(167, 139, 250, 0.8)',
    accent: '#8b5cf6',
  },
  loyalty: {
    bg: 'rgba(168, 85, 247, 0.9)',
    border: 'rgba(192, 132, 252, 0.8)',
    accent: '#a855f7',
  },
  sacrifice: {
    bg: 'rgba(239, 68, 68, 0.9)',
    border: 'rgba(252, 165, 165, 0.8)',
    accent: '#ef4444',
  },
  default: {
    bg: 'rgba(30, 41, 59, 0.95)',
    border: 'rgba(100, 116, 139, 0.6)',
    accent: '#64748b',
  },
  disabled: {
    bg: 'rgba(55, 65, 81, 0.8)',
    border: 'rgba(75, 85, 99, 0.6)',
    accent: '#6b7280',
  },
  // Loyalty direction colors
  loyaltyPositive: {
    bg: 'rgba(34, 197, 94, 0.9)',
    border: 'rgba(74, 222, 128, 0.8)',
    accent: '#22c55e',
  },
  loyaltyNegative: {
    bg: 'rgba(239, 68, 68, 0.9)',
    border: 'rgba(252, 165, 165, 0.8)',
    accent: '#ef4444',
  },
  loyaltyNeutral: {
    bg: 'rgba(139, 92, 246, 0.9)',
    border: 'rgba(167, 139, 250, 0.8)',
    accent: '#8b5cf6',
  },
  // Text colors
  activeText: '#fff',
  inactiveText: '#9ca3af',
};

// Type for color scheme objects with optional accent
type ColorScheme = {
  bg: string;
  border: string;
  accent?: string;
};

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
  onActivateAbility?: (permanentId: string, abilityId: string, ability: ParsedActivatedAbility, xValue?: number) => void;
  // Display options
  showOnHover?: boolean;
  maxVisible?: number;
  position?: 'left' | 'bottom' | 'loyalty-inline';
  // Filter to show only loyalty abilities (for planeswalkers)
  loyaltyAbilitiesOnly?: boolean;
}

/**
 * Individual ability button component with hover state and keyword-highlighted tooltip
 */
function AbilityButton({
  ability,
  canActivate,
  reason,
  scale,
  onActivate,
}: {
  ability: ParsedActivatedAbility;
  canActivate: boolean;
  reason?: string;
  scale: number;
  onActivate: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  
  const icon = getAbilityIcon(ability);
  const costText = formatAbilityCost(ability);
  
  // Get color scheme based on ability type
  let colorScheme: ColorScheme = COLORS.default;
  if (ability.isManaAbility) {
    colorScheme = COLORS.mana;
  } else if (ability.isFetchAbility) {
    colorScheme = COLORS.fetch;
  } else if (ability.isLoyaltyAbility) {
    colorScheme = COLORS.loyalty;
  } else if (ability.requiresSacrifice) {
    colorScheme = COLORS.sacrifice;
  }
  
  // Override with disabled colors if not activatable
  if (!canActivate) {
    colorScheme = COLORS.disabled;
  }
  
  const { bg: bgColor, border: borderColor, accent: accentColor } = colorScheme;
  
  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => {
        setIsHovered(true);
        // Delay showing tooltip to avoid flashing
        setTimeout(() => setShowTooltip(true), 200);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowTooltip(false);
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (canActivate) {
            onActivate();
          }
        }}
        disabled={!canActivate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(4 * scale),
          padding: `${Math.round(4 * scale)}px ${Math.round(8 * scale)}px`,
          background: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: Math.round(6 * scale),
          color: canActivate ? COLORS.activeText : COLORS.inactiveText,
          fontSize: Math.round(10 * scale),
          fontWeight: 500,
          cursor: canActivate ? 'pointer' : 'not-allowed',
          whiteSpace: 'nowrap',
          boxShadow: canActivate && isHovered 
            ? '0 4px 12px rgba(0,0,0,0.4)' 
            : canActivate 
              ? '0 2px 8px rgba(0,0,0,0.3)' 
              : 'none',
          transform: canActivate && isHovered ? 'scale(1.05)' : 'scale(1)',
          transition: 'transform 0.1s ease, box-shadow 0.1s ease',
          opacity: canActivate ? 1 : 0.6,
          pointerEvents: 'auto',
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
      
      {/* Enhanced tooltip with keyword highlighting */}
      {isHovered && showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            padding: '10px 14px',
            background: 'rgba(15, 23, 42, 0.98)',
            border: `1px solid ${accentColor}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 1000,
            whiteSpace: 'normal',
            width: 'max-content',
            maxWidth: 280,
            textAlign: 'left',
            pointerEvents: 'none',
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: Math.round(11 * scale),
              fontWeight: 700,
              color: accentColor,
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{icon}</span>
            <span>{ability.label}</span>
          </div>
          
          {/* Cost */}
          <div
            style={{
              fontSize: Math.round(9 * scale),
              color: '#94a3b8',
              marginBottom: 8,
              padding: '4px 8px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 4,
              display: 'inline-block',
            }}
          >
            Cost: {costText}
          </div>
          
          {/* Description with keyword highlighting */}
          <div style={{ marginTop: 4 }}>
            <KeywordHighlighter
              text={ability.description}
              fontSize={Math.round(10 * scale)}
              baseColor="#e2e8f0"
            />
          </div>
          
          {/* Reason why it can't be activated */}
          {!canActivate && reason && (
            <div
              style={{
                marginTop: 8,
                padding: '4px 8px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 4,
                fontSize: Math.round(9 * scale),
                color: '#fca5a5',
              }}
            >
              ⚠️ {reason}
            </div>
          )}
          
          {/* Timing restrictions */}
          {ability.timingRestriction && (
            <div
              style={{
                marginTop: 6,
                fontSize: Math.round(8 * scale),
                color: '#94a3b8',
                fontStyle: 'italic',
              }}
            >
              {ability.timingRestriction === 'sorcery' 
                ? '⏱️ Activate only as a sorcery' 
                : '⚡ Activate at instant speed'}
            </div>
          )}
          
          {ability.oncePerTurn && (
            <div
              style={{
                marginTop: 4,
                fontSize: Math.round(8 * scale),
                color: '#94a3b8',
                fontStyle: 'italic',
              }}
            >
              🔄 Once per turn
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact loyalty ability button for inline display on planeswalkers
 */
function CompactLoyaltyButton({
  ability,
  canActivate,
  reason,
  scale,
  onActivate,
}: {
  ability: ParsedActivatedAbility;
  canActivate: boolean;
  reason?: string;
  scale: number;
  onActivate: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  // Determine button color based on loyalty cost
  const loyaltyCost = ability.loyaltyCost ?? 0;
  const isPositive = loyaltyCost > 0;
  const isNegative = loyaltyCost < 0;
  
  // Get color scheme based on loyalty direction
  let colorScheme: ColorScheme = COLORS.loyaltyNeutral;
  if (isPositive) {
    colorScheme = COLORS.loyaltyPositive;
  } else if (isNegative) {
    colorScheme = COLORS.loyaltyNegative;
  }
  
  // Override with disabled colors if not activatable
  if (!canActivate) {
    colorScheme = COLORS.disabled;
  }
  
  const { bg: bgColor, border: borderColor } = colorScheme;
  
  // Format loyalty cost for display
  const costDisplay = loyaltyCost > 0 ? `+${loyaltyCost}` : `${loyaltyCost}`;
  
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (canActivate) {
            onActivate();
          }
        }}
        disabled={!canActivate}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: Math.round(28 * scale),
          height: Math.round(20 * scale),
          background: bgColor,
          border: `1px solid ${borderColor}`,
          borderRadius: Math.round(4 * scale),
          color: canActivate ? COLORS.activeText : COLORS.inactiveText,
          fontSize: Math.round(10 * scale),
          fontWeight: 700,
          cursor: canActivate ? 'pointer' : 'not-allowed',
          boxShadow: canActivate && isHovered 
            ? '0 2px 8px rgba(0,0,0,0.4)' 
            : canActivate 
              ? '0 1px 4px rgba(0,0,0,0.3)' 
              : 'none',
          transform: canActivate && isHovered ? 'scale(1.1)' : 'scale(1)',
          transition: 'transform 0.1s ease, box-shadow 0.1s ease',
          opacity: canActivate ? 1 : 0.5,
          pointerEvents: 'auto',
        }}
        title={`${costDisplay}: ${ability.description}${!canActivate && reason ? ` (${reason})` : ''}`}
      >
        {costDisplay}
      </button>
    </div>
  );
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
 * Check if a permanent is a planeswalker
 */
function isPlaneswalker(perm: BattlefieldPermanent): boolean {
  const kc = perm.card as KnownCardRef;
  const typeLine = (kc?.type_line || '').toLowerCase();
  return typeLine.includes('planeswalker');
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
  loyaltyAbilitiesOnly = false,
}: ActivatedAbilityButtonsProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [xModalState, setXModalState] = useState<{
    isOpen: boolean;
    ability: ParsedActivatedAbility | null;
  }>({ isOpen: false, ability: null });
  
  const kc = perm.card as KnownCardRef;
  // Scale factor with minimum to ensure readability
  const rawScale = tileWidth / 110;
  const scale = Math.max(0.7, rawScale);
  
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
  
  // Filter abilities if loyaltyAbilitiesOnly is set
  const filteredAbilities = loyaltyAbilitiesOnly 
    ? annotatedAbilities.filter(a => a.ability.isLoyaltyAbility)
    : annotatedAbilities;
  
  // Return null if filtering leaves no abilities
  if (filteredAbilities.length === 0) {
    return null;
  }
  
  // Show/hide based on hover if showOnHover is true
  const shouldShow = showOnHover ? hovered : true;
  const visibleAbilities = expanded ? filteredAbilities : filteredAbilities.slice(0, maxVisible);
  const hasMore = filteredAbilities.length > maxVisible;
  
  const handleActivate = (ability: ParsedActivatedAbility) => {
    // If ability has X cost, show modal to select X value
    if (ability.hasXCost) {
      setXModalState({ isOpen: true, ability });
      return;
    }
    
    // Otherwise, activate directly
    if (onActivateAbility) {
      onActivateAbility(perm.id, ability.id, ability);
    }
  };
  
  const handleXValueSelected = (xValue: number) => {
    if (xModalState.ability && onActivateAbility) {
      onActivateAbility(perm.id, xModalState.ability.id, xModalState.ability, xValue);
    }
    setXModalState({ isOpen: false, ability: null });
  };
  
  // Check if this is a planeswalker for inline loyalty positioning
  const isPW = isPlaneswalker(perm);
  
  // Positioning styles based on position prop
  let containerStyle: React.CSSProperties;
  
  if (position === 'loyalty-inline' && isPW) {
    // For planeswalkers, show loyalty buttons vertically on the left, spaced to match card text
    containerStyle = {
      position: 'absolute',
      left: Math.round(2 * scale),
      top: '35%',  // Positioned roughly where abilities text would be on the card
      display: 'flex',
      flexDirection: 'column',
      gap: Math.round(8 * scale),  // More spacing to match ability text lines
      zIndex: 30,
      opacity: shouldShow ? 1 : 0,
      transition: 'opacity 0.15s ease',
      pointerEvents: shouldShow ? 'auto' : 'none',
    };
  } else if (position === 'left') {
    containerStyle = {
      position: 'absolute',
      left: Math.round(4 * scale),
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: Math.round(3 * scale),
      zIndex: 30,
      opacity: shouldShow ? 1 : 0,
      transition: 'opacity 0.15s ease',
      pointerEvents: shouldShow ? 'auto' : 'none',
    };
  } else {
    // bottom position
    containerStyle = {
      position: 'absolute',
      left: '50%',
      bottom: Math.round(4 * scale),
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'row',
      gap: Math.round(3 * scale),
      zIndex: 30,
      opacity: shouldShow ? 1 : 0,
      transition: 'opacity 0.15s ease',
      pointerEvents: shouldShow ? 'auto' : 'none',
    };
  }
  
  // Use compact buttons for loyalty-inline mode
  const useCompactLoyaltyButtons = position === 'loyalty-inline' && loyaltyAbilitiesOnly;
  
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
        pointerEvents: showOnHover ? 'auto' : 'none',
      }}
    >
      {/* Ability buttons container - now inside the card */}
      <div style={containerStyle}>
        {visibleAbilities.map(({ ability, canActivate, reason }) => (
          useCompactLoyaltyButtons && ability.isLoyaltyAbility ? (
            <CompactLoyaltyButton
              key={ability.id}
              ability={ability}
              canActivate={canActivate}
              reason={reason}
              scale={scale}
              onActivate={() => handleActivate(ability)}
            />
          ) : (
            <AbilityButton
              key={ability.id}
              ability={ability}
              canActivate={canActivate}
              reason={reason}
              scale={scale}
              onActivate={() => handleActivate(ability)}
            />
          )
        ))}
        
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
      
      {/* X Value Selection Modal */}
      {xModalState.ability && (
        <XValueSelectionModal
          isOpen={xModalState.isOpen}
          onClose={() => setXModalState({ isOpen: false, ability: null })}
          onSelect={handleXValueSelected}
          cardName={kc?.name || 'Unknown Card'}
          abilityText={xModalState.ability.effect}
          minValue={0}
          maxValue={20}
        />
      )}
    </div>
  );
}

export default ActivatedAbilityButtons;
