// client/src/components/CardOverlay.tsx
// Overlay badges for cards on the battlefield: keywords, P/T, loyalty, attack indicators

import React from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../shared/src';

interface Props {
  perm: BattlefieldPermanent;
  players?: { id: string; name: string }[];
  tileWidth: number;
  showAbilities?: boolean;
  showPT?: boolean;
  showLoyalty?: boolean;
  showAttackIndicator?: boolean;
  showTargetedIndicator?: boolean;
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

  const scale = tileWidth / 110; // Base scale factor

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

      {/* P/T display for creatures */}
      {showPT && isCreature && effP !== undefined && effT !== undefined && (
        <div style={{
          position: 'absolute',
          right: Math.round(4 * scale),
          bottom: Math.round(24 * scale),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: Math.round(1 * scale),
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: Math.round(2 * scale),
            padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
            borderRadius: Math.round(4 * scale),
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          }}>
            <span style={{
              fontSize: Math.round(12 * scale),
              fontWeight: 700,
              color: getPTColor(baseP, effP),
            }}>
              {effP}
            </span>
            <span style={{
              fontSize: Math.round(10 * scale),
              color: '#9ca3af',
            }}>/</span>
            <span style={{
              fontSize: Math.round(12 * scale),
              fontWeight: 700,
              color: getPTColor(baseT, effT),
            }}>
              {effT}
            </span>
          </div>
          {/* Show base if different */}
          {(baseP !== effP || baseT !== effT) && baseP !== undefined && baseT !== undefined && (
            <span style={{
              fontSize: Math.round(8 * scale),
              color: '#9ca3af',
              opacity: 0.8,
            }}>
              base {baseP}/{baseT}
            </span>
          )}
        </div>
      )}

      {/* Loyalty display for planeswalkers */}
      {showLoyalty && isPlaneswalker && currentLoyalty !== undefined && (
        <div style={{
          position: 'absolute',
          right: Math.round(4 * scale),
          bottom: Math.round(24 * scale),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: Math.round(1 * scale),
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: Math.round(28 * scale),
            height: Math.round(28 * scale),
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(139,92,246,0.9), rgba(168,85,247,0.9))',
            border: '2px solid #c084fc',
            boxShadow: '0 2px 8px rgba(139,92,246,0.4)',
          }}>
            <span style={{
              fontSize: Math.round(12 * scale),
              fontWeight: 700,
              color: getLoyaltyColor(baseLoyalty, currentLoyalty),
              textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}>
              {currentLoyalty}
            </span>
          </div>
          {baseLoyalty !== undefined && baseLoyalty !== currentLoyalty && (
            <span style={{
              fontSize: Math.round(8 * scale),
              color: '#c4b5fd',
              opacity: 0.8,
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
