// client/src/components/CardOverlay.tsx
// Overlay badges for cards on the battlefield: keywords, P/T, loyalty, attack indicators

import React, { useState } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID, PTBonusSource } from '../../../shared/src';

interface Props {
  perm: BattlefieldPermanent;
  players?: { id: string; name: string }[];
  tileWidth: number;
  showAbilities?: boolean;
  showPT?: boolean;
  showLoyalty?: boolean;
  showAttackIndicator?: boolean;
  showTargetedIndicator?: boolean;
  showDamage?: boolean;  // Show sustained damage indicator
}

// Extended ability label map with more keywords
const abilityLabelMap: Record<string, { short: string; color: string; description: string }> = {
  // Evasion
  flying: { short: 'Fly', color: '#60a5fa', description: 'Flying' },
  menace: { short: 'Men', color: '#f87171', description: 'Menace - Must be blocked by 2+ creatures' },
  trample: { short: 'Trm', color: '#34d399', description: 'Trample - Excess damage dealt to defending player' },
  shadow: { short: 'Shd', color: '#6b7280', description: 'Shadow - Can only block/be blocked by shadow' },
  fear: { short: 'Fer', color: '#374151', description: 'Fear - Can only be blocked by artifact/black creatures' },
  intimidate: { short: 'Int', color: '#4b5563', description: 'Intimidate - Can only be blocked by artifact/same color' },
  skulk: { short: 'Skl', color: '#9ca3af', description: 'Skulk - Can\'t be blocked by creatures with greater power' },
  reach: { short: 'Rch', color: '#22c55e', description: 'Reach - Can block creatures with flying' },
  
  // Combat keywords
  deathtouch: { short: 'Dth', color: '#10b981', description: 'Deathtouch - Any damage destroys' },
  firstStrike: { short: '1st', color: '#ef4444', description: 'First Strike - Deals combat damage first' },
  first_strike: { short: '1st', color: '#ef4444', description: 'First Strike - Deals combat damage first' },
  doubleStrike: { short: '2x', color: '#dc2626', description: 'Double Strike - Deals first strike and normal damage' },
  double_strike: { short: '2x', color: '#dc2626', description: 'Double Strike - Deals first strike and normal damage' },
  lifelink: { short: 'Lnk', color: '#f0abfc', description: 'Lifelink - Damage dealt heals controller' },
  vigilance: { short: 'Vig', color: '#fbbf24', description: 'Vigilance - Attacking doesn\'t cause tapping' },
  
  // Protection
  hexproof: { short: 'Hex', color: '#3b82f6', description: 'Hexproof - Can\'t be targeted by opponents' },
  shroud: { short: 'Shr', color: '#6366f1', description: 'Shroud - Can\'t be targeted' },
  indestructible: { short: 'Ind', color: '#eab308', description: 'Indestructible - Can\'t be destroyed' },
  ward: { short: 'Wrd', color: '#8b5cf6', description: 'Ward - Spells/abilities targeting must pay extra' },
  
  // Static abilities
  defender: { short: 'Def', color: '#78716c', description: 'Defender - Can\'t attack' },
  haste: { short: 'Hst', color: '#f97316', description: 'Haste - Can attack/tap immediately' },
  flash: { short: 'Flh', color: '#14b8a6', description: 'Flash - Can be cast at instant speed' },
  
  // Counters and growth
  persist: { short: 'Per', color: '#84cc16', description: 'Persist - Returns with -1/-1 counter when it dies' },
  undying: { short: 'Udy', color: '#22d3ee', description: 'Undying - Returns with +1/+1 counter when it dies' },
  wither: { short: 'Wth', color: '#65a30d', description: 'Wither - Deals damage as -1/-1 counters' },
  infect: { short: 'Inf', color: '#4ade80', description: 'Infect - Deals damage as -1/-1 or poison counters' },
  
  // Special
  landwalk: { short: 'Lwk', color: '#a3e635', description: 'Landwalk - Unblockable if defender controls land type' },
  protection: { short: 'Pro', color: '#fcd34d', description: 'Protection - Can\'t be blocked/targeted/damaged by type' },
};

// Calculate power/toughness colors
function getPTColor(base: number | undefined, effective: number | undefined): string {
  if (base === undefined || effective === undefined) return '#ffffff';
  if (effective > base) return '#22c55e'; // Green - increased
  if (effective < base) return '#ef4444'; // Red - decreased
  return '#d1d5db'; // Neutral gray - unchanged
}

// Calculate loyalty color
function getLoyaltyColor(base: number | undefined, current: number | undefined): string {
  if (base === undefined || current === undefined) return '#c084fc';
  if (current > base) return '#22c55e'; // Green - increased
  if (current < base) return '#ef4444'; // Red - decreased
  return '#c084fc'; // Purple - unchanged (default planeswalker color)
}

export function CardOverlay({
  perm,
  players = [],
  tileWidth,
  showAbilities = true,
  showPT = true,
  showLoyalty = true,
  showAttackIndicator = true,
  showTargetedIndicator = true,
  showDamage = true,
}: Props) {
  const kc = perm.card as KnownCardRef;
  const typeLine = (kc?.type_line || '').toLowerCase();
  const isCreature = /\bcreature\b/.test(typeLine);
  const isPlaneswalker = /\bplaneswalker\b/.test(typeLine);

  // Parse base P/T
  const parsePT = (raw?: string | number): number | undefined => {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10);
    return undefined;
  };

  const baseP = typeof perm.basePower === 'number' ? perm.basePower : parsePT(kc?.power);
  const baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parsePT(kc?.toughness);

  // Calculate effective P/T
  let effP = perm.effectivePower;
  let effT = perm.effectiveToughness;
  if (effP === undefined && baseP !== undefined) {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    effP = baseP + plus - minus;
  }
  if (effT === undefined && baseT !== undefined) {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    effT = baseT + plus - minus;
  }

  // Granted abilities
  const abilities = perm.grantedAbilities || [];

  // P/T bonus sources for tooltip
  const ptSources = perm.ptSources || [];

  // Damage marked on the creature (sustained damage this turn)
  const damageMarked = perm.damageMarked ?? 0;

  // Attack indicator
  const attackingPlayer = perm.attacking;
  const attackingPlayerName = attackingPlayer 
    ? players.find(p => p.id === attackingPlayer)?.name || attackingPlayer 
    : null;

  // Blocking
  const blockingCreatures = perm.blocking || [];
  const blockedByCreatures = perm.blockedBy || [];

  // Loyalty (for planeswalkers)
  const baseLoyalty = perm.baseLoyalty ?? (kc as any)?.loyalty;
  const currentLoyalty = perm.loyalty ?? perm.counters?.['loyalty'];

  // Targeted by indicator
  const targetedBy = perm.targetedBy || [];

  // Scale factor with minimum to ensure readability on small cards
  // Minimum scale of 0.7 ensures text remains readable even on small tiles
  const rawScale = tileWidth / 110;
  const scale = Math.max(0.7, rawScale);

  // State for P/T tooltip
  const [showPTTooltip, setShowPTTooltip] = useState(false);

  // Build the P/T modifier breakdown for tooltip
  const buildModifierBreakdown = (): { lines: string[]; hasModifiers: boolean } => {
    const lines: string[] = [];
    let hasModifiers = false;

    // Base P/T
    if (baseP !== undefined && baseT !== undefined) {
      lines.push(`Base: ${baseP}/${baseT}`);
    }

    // +1/+1 counters
    const plusCounters = perm.counters?.['+1/+1'] ?? 0;
    if (plusCounters > 0) {
      lines.push(`${plusCounters}× +1/+1 counters`);
      hasModifiers = true;
    }

    // -1/-1 counters
    const minusCounters = perm.counters?.['-1/-1'] ?? 0;
    if (minusCounters > 0) {
      lines.push(`${minusCounters}× -1/-1 counters`);
      hasModifiers = true;
    }

    // Other P/T sources (from continuous effects, equipment, auras, etc.)
    for (const source of ptSources) {
      const pStr = source.power >= 0 ? `+${source.power}` : `${source.power}`;
      const tStr = source.toughness >= 0 ? `+${source.toughness}` : `${source.toughness}`;
      lines.push(`${source.name}: ${pStr}/${tStr}`);
      hasModifiers = true;
    }

    return { lines, hasModifiers };
  };

  const { lines: modifierLines, hasModifiers } = buildModifierBreakdown();

  return (
    <>
      {/* Granted abilities badges */}
      {showAbilities && abilities.length > 0 && (
        <div style={{
          position: 'absolute',
          top: Math.round(4 * scale),
          right: Math.round(4 * scale),
          display: 'flex',
          flexWrap: 'wrap',
          gap: Math.round(2 * scale),
          maxWidth: '70%',
          justifyContent: 'flex-end',
        }}>
          {abilities.slice(0, 6).map((ability) => {
            const key = ability.toLowerCase().replace(/[^a-z]/g, '');
            const config = abilityLabelMap[key] || abilityLabelMap[ability.toLowerCase()] || {
              short: ability.slice(0, 3).toUpperCase(),
              color: '#6b7280',
              description: ability,
            };
            return (
              <span
                key={ability}
                title={config.description}
                style={{
                  background: `${config.color}cc`,
                  color: '#fff',
                  padding: `${Math.round(1 * scale)}px ${Math.round(4 * scale)}px`,
                  borderRadius: Math.round(3 * scale),
                  fontSize: Math.round(9 * scale),
                  fontWeight: 600,
                  lineHeight: '1.2',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  border: `1px solid ${config.color}`,
                }}
              >
                {config.short}
              </span>
            );
          })}
          {abilities.length > 6 && (
            <span
              title={abilities.slice(6).join(', ')}
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                padding: `${Math.round(1 * scale)}px ${Math.round(3 * scale)}px`,
                borderRadius: Math.round(3 * scale),
                fontSize: Math.round(8 * scale),
                fontWeight: 500,
              }}
            >
              +{abilities.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Counter badges - show all counter types on the permanent (except +1/+1 and -1/-1 which are in P/T) */}
      {(() => {
        // Build list of displayable counters (excluding +1/+1 and -1/-1 which affect P/T)
        const counters = perm.counters || {};
        const displayCounters: Array<{ type: string; count: number; color: string; icon: string }> = [];
        
        // Counter type configurations
        const counterConfig: Record<string, { color: string; icon: string }> = {
          'charge': { color: '#3b82f6', icon: '⚡' },
          'level': { color: '#8b5cf6', icon: '📊' },
          'loyalty': { color: '#c084fc', icon: '❤️' }, // Only show if not planeswalker (PW has separate display)
          'storage': { color: '#14b8a6', icon: '💎' },
          'age': { color: '#78716c', icon: '⏳' },
          'fade': { color: '#6b7280', icon: '💨' },
          'time': { color: '#60a5fa', icon: '⏰' },
          'quest': { color: '#fbbf24', icon: '⭐' },
          'lore': { color: '#a78bfa', icon: '📖' },
          'verse': { color: '#f472b6', icon: '🎵' },
          'spore': { color: '#22c55e', icon: '🍄' },
          'blood': { color: '#dc2626', icon: '🩸' },
          'oil': { color: '#1f2937', icon: '🛢️' },
          'energy': { color: '#f59e0b', icon: '🔋' },
          'poison': { color: '#84cc16', icon: '☠️' },
          'bounty': { color: '#eab308', icon: '💰' },
          'doom': { color: '#7c3aed', icon: '💀' },
          'hatchling': { color: '#f97316', icon: '🥚' },
          'brick': { color: '#d97706', icon: '🧱' },
          'pressure': { color: '#ef4444', icon: '💢' },
          'page': { color: '#e5e7eb', icon: '📄' },
          'ki': { color: '#06b6d4', icon: '☯️' },
          'experience': { color: '#10b981', icon: '✨' },
        };
        
        for (const [counterType, count] of Object.entries(counters)) {
          if (count <= 0) continue;
          // Skip +1/+1 and -1/-1 (handled in P/T tooltip)
          if (counterType === '+1/+1' || counterType === '-1/-1') continue;
          // Skip loyalty for planeswalkers (has separate display)
          if (counterType === 'loyalty' && isPlaneswalker) continue;
          
          const config = counterConfig[counterType.toLowerCase()] || { color: '#6b7280', icon: '●' };
          displayCounters.push({
            type: counterType,
            count: count as number,
            color: config.color,
            icon: config.icon,
          });
        }
        
        if (displayCounters.length === 0) return null;
        
        return (
          <div style={{
            position: 'absolute',
            top: abilities.length > 0 ? Math.round(28 * scale) : Math.round(4 * scale),
            left: Math.round(4 * scale),
            display: 'flex',
            flexWrap: 'wrap',
            gap: Math.round(3 * scale),
            maxWidth: '60%',
            zIndex: 15,
          }}>
            {displayCounters.map(({ type, count, color, icon }) => (
              <div
                key={type}
                title={`${count} ${type} counter${count !== 1 ? 's' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: Math.round(2 * scale),
                  background: `linear-gradient(135deg, ${color}dd, ${color}99)`,
                  padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                  borderRadius: Math.round(4 * scale),
                  border: `1px solid ${color}`,
                  boxShadow: `0 2px 6px ${color}40`,
                }}
              >
                <span style={{ fontSize: Math.round(10 * scale) }}>{icon}</span>
                <span style={{
                  fontSize: Math.round(10 * scale),
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* P/T display for creatures with hover tooltip - positioned in lower right like real MTG cards */}
      {showPT && isCreature && effP !== undefined && effT !== undefined && (
        <div 
          style={{
            position: 'absolute',
            right: Math.round(4 * scale),
            bottom: Math.round(4 * scale),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: Math.round(2 * scale),
            zIndex: 20,
          }}
          onMouseEnter={() => (hasModifiers || damageMarked > 0) && setShowPTTooltip(true)}
          onMouseLeave={() => setShowPTTooltip(false)}
        >
          {/* Main P/T badge - styled like the P/T box on real MTG cards */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: Math.round(2 * scale),
            padding: `${Math.round(3 * scale)}px ${Math.round(8 * scale)}px`,
            borderRadius: Math.round(6 * scale),
            background: 'linear-gradient(135deg, rgba(40,40,50,0.95), rgba(25,25,35,0.98))',
            border: hasModifiers 
              ? '2px solid rgba(255,215,0,0.7)' 
              : damageMarked > 0 
                ? '2px solid rgba(239,68,68,0.7)' 
                : '2px solid rgba(200,200,200,0.4)',
            boxShadow: hasModifiers 
              ? '0 2px 8px rgba(255,215,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' 
              : damageMarked > 0
                ? '0 2px 8px rgba(239,68,68,0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
                : '0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
            cursor: (hasModifiers || damageMarked > 0) ? 'help' : 'default',
            minWidth: Math.round(36 * scale),
            justifyContent: 'center',
          }}>
            <span style={{
              fontSize: Math.round(14 * scale),
              fontWeight: 700,
              color: getPTColor(baseP, effP),
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}>
              {effP}
            </span>
            <span style={{
              fontSize: Math.round(11 * scale),
              color: '#9ca3af',
              fontWeight: 600,
            }}>/</span>
            <span style={{
              fontSize: Math.round(14 * scale),
              fontWeight: 700,
              color: getPTColor(baseT, effT),
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}>
              {effT}
            </span>
          </div>

          {/* Sustained damage indicator - shows damage marked on creature */}
          {showDamage && damageMarked > 0 && effT !== undefined && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: Math.round(2 * scale),
              padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
              borderRadius: Math.round(4 * scale),
              background: 'linear-gradient(135deg, rgba(239,68,68,0.9), rgba(185,28,28,0.9))',
              border: '1px solid rgba(252,165,165,0.6)',
              boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
            }}>
              <span style={{ fontSize: Math.round(8 * scale) }}>💔</span>
              <span style={{
                fontSize: Math.round(10 * scale),
                fontWeight: 600,
                color: '#fff',
                textShadow: '0 1px 1px rgba(0,0,0,0.3)',
              }}>
                {damageMarked}/{effT}
              </span>
            </div>
          )}
          
          {/* P/T Breakdown Tooltip */}
          {showPTTooltip && (hasModifiers || damageMarked > 0) && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              right: 0,
              marginBottom: 6,
              padding: '10px 14px',
              background: 'rgba(15,15,25,0.98)',
              borderRadius: 8,
              border: '1px solid rgba(255,215,0,0.4)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
              zIndex: 1000,
              minWidth: 180,
              maxWidth: 280,
            }}>
              {/* Header */}
              <div style={{ 
                fontSize: 12, 
                fontWeight: 700, 
                color: '#fbbf24', 
                marginBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.15)',
                paddingBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span>⚔️</span>
                <span>P/T Breakdown</span>
              </div>

              {/* Modifier list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {modifierLines.map((line, idx) => {
                  const isBase = line.startsWith('Base:');
                  const isPositive = line.includes('+1/+1') || (line.includes('+') && !line.includes('-'));
                  const isNegative = line.includes('-1/-1') || (line.includes('-') && !line.includes('+'));
                  return (
                    <div key={idx} style={{ 
                      fontSize: 11, 
                      color: isBase ? '#d1d5db' : isPositive ? '#22c55e' : isNegative ? '#ef4444' : '#e5e7eb',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '2px 0',
                    }}>
                      <span>{line}</span>
                    </div>
                  );
                })}
              </div>

              {/* Damage section */}
              {damageMarked > 0 && effT !== undefined && (
                <>
                  <div style={{ 
                    borderTop: '1px solid rgba(255,255,255,0.15)',
                    marginTop: 8,
                    paddingTop: 8,
                  }}>
                    <div style={{ 
                      fontSize: 11, 
                      fontWeight: 600, 
                      color: '#ef4444',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                      <span>💔 Sustained Damage:</span>
                      <span>{damageMarked}/{effT}</span>
                    </div>
                    {damageMarked >= effT && (
                      <div style={{
                        fontSize: 10,
                        color: '#fca5a5',
                        fontStyle: 'italic',
                        marginTop: 4,
                      }}>
                        ⚠️ Lethal damage marked!
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Total */}
              <div style={{ 
                borderTop: '1px solid rgba(255,255,255,0.15)',
                marginTop: 8,
                paddingTop: 6,
              }}>
                <div style={{ 
                  fontSize: 12, 
                  fontWeight: 700, 
                  color: '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}>
                  <span>Effective P/T:</span>
                  <span style={{ 
                    color: (effP !== baseP || effT !== baseT) ? '#fbbf24' : '#fff' 
                  }}>
                    {effP}/{effT}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loyalty display for planeswalkers - positioned in lower right corner like a real planeswalker card */}
      {showLoyalty && isPlaneswalker && currentLoyalty !== undefined && (
        <div style={{
          position: 'absolute',
          right: Math.round(4 * scale),
          bottom: Math.round(4 * scale),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: Math.round(3 * scale),
          zIndex: 20,
        }}>
          {/* Loyalty shield badge - styled like actual planeswalker loyalty counter */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: Math.round(32 * scale),
            height: Math.round(36 * scale),
            background: 'linear-gradient(180deg, rgba(80,60,120,0.95) 0%, rgba(50,30,80,0.98) 100%)',
            border: '2px solid #a78bfa',
            borderRadius: `${Math.round(4 * scale)}px ${Math.round(4 * scale)}px ${Math.round(16 * scale)}px ${Math.round(16 * scale)}px`,
            boxShadow: '0 3px 10px rgba(139,92,246,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
            position: 'relative',
          }}>
            {/* Inner glow for emphasis */}
            <div style={{
              position: 'absolute',
              inset: 2,
              background: 'radial-gradient(ellipse at center, rgba(168,139,250,0.3) 0%, transparent 70%)',
              borderRadius: 'inherit',
              pointerEvents: 'none',
            }} />
            <span style={{
              fontSize: Math.round(14 * scale),
              fontWeight: 700,
              color: getLoyaltyColor(baseLoyalty, currentLoyalty),
              textShadow: '0 1px 3px rgba(0,0,0,0.6), 0 0 8px rgba(168,139,250,0.4)',
              position: 'relative',
              zIndex: 1,
            }}>
              {currentLoyalty}
            </span>
          </div>
          {/* Starting loyalty indicator */}
          {baseLoyalty !== undefined && baseLoyalty !== currentLoyalty && (
            <span style={{
              fontSize: Math.round(9 * scale),
              color: '#c4b5fd',
              fontWeight: 500,
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}>
              start {baseLoyalty}
            </span>
          )}
        </div>
      )}

      {/* Attack indicator */}
      {showAttackIndicator && attackingPlayerName && (
        <div style={{
          position: 'absolute',
          left: '50%',
          top: Math.round(-14 * scale),
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(3 * scale),
          padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
          borderRadius: Math.round(4 * scale),
          background: 'linear-gradient(90deg, rgba(239,68,68,0.9), rgba(220,38,38,0.9))',
          border: '1px solid #fca5a5',
          boxShadow: '0 2px 8px rgba(239,68,68,0.4)',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <span style={{ fontSize: Math.round(10 * scale) }}>⚔️</span>
          <span style={{
            fontSize: Math.round(9 * scale),
            fontWeight: 600,
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
          }}>
            → {attackingPlayerName}
          </span>
        </div>
      )}

      {/* Blocking indicator */}
      {showAttackIndicator && blockingCreatures.length > 0 && (
        <div style={{
          position: 'absolute',
          left: '50%',
          top: Math.round(-14 * scale),
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(3 * scale),
          padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
          borderRadius: Math.round(4 * scale),
          background: 'linear-gradient(90deg, rgba(59,130,246,0.9), rgba(37,99,235,0.9))',
          border: '1px solid #93c5fd',
          boxShadow: '0 2px 8px rgba(59,130,246,0.4)',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <span style={{ fontSize: Math.round(10 * scale) }}>🛡️</span>
          <span style={{
            fontSize: Math.round(9 * scale),
            fontWeight: 600,
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
          }}>
            Blocking {blockingCreatures.length}
          </span>
        </div>
      )}

      {/* Blocked by indicator */}
      {showAttackIndicator && blockedByCreatures.length > 0 && (
        <div style={{
          position: 'absolute',
          left: '50%',
          bottom: Math.round(-10 * scale),
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(2 * scale),
          padding: `${Math.round(1 * scale)}px ${Math.round(4 * scale)}px`,
          borderRadius: Math.round(3 * scale),
          background: 'rgba(239,68,68,0.8)',
          fontSize: Math.round(8 * scale),
          color: '#fff',
          whiteSpace: 'nowrap',
        }}>
          ⛔ Blocked by {blockedByCreatures.length}
        </div>
      )}

      {/* Targeted indicator */}
      {showTargetedIndicator && targetedBy.length > 0 && (
        <div style={{
          position: 'absolute',
          left: Math.round(4 * scale),
          top: Math.round(4 * scale),
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(2 * scale),
          padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
          borderRadius: Math.round(4 * scale),
          background: 'linear-gradient(90deg, rgba(245,158,11,0.9), rgba(217,119,6,0.9))',
          border: '1px solid #fcd34d',
          boxShadow: '0 0 8px rgba(245,158,11,0.5)',
          animation: 'pulse 2s ease-in-out infinite',
        }}>
          <span style={{ fontSize: Math.round(10 * scale) }}>🎯</span>
          <span style={{
            fontSize: Math.round(9 * scale),
            fontWeight: 600,
            color: '#fff',
          }}>
            {targetedBy.length}
          </span>
        </div>
      )}
    </>
  );
}

export default CardOverlay;
