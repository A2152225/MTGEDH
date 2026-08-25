// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: getCreatureInfo (and DangerIndicators, which it closes over).
// Public entry symbols: getCreatureInfo, DangerIndicators.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import type { BattlefieldPermanent, KnownCardRef } from '../../../../shared/src';
import { getCombinedPermanentText } from '../../utils/permanentText';
import { getPermanentGoaders, isPermanentGoaded } from '../../utils/combatGoad';

/**
 * Dangerous combat abilities that players should be warned about
 */
export interface DangerIndicators {
  deathtouch: boolean;
  infect: boolean;
  toxic: number; // 0 if no toxic, otherwise the toxic value
  trample: boolean;
  menace: boolean;
  firstStrike: boolean;
  doubleStrike: boolean;
  lifelink: boolean;
  indestructible: boolean;
  goaded: boolean; // If creature is goaded and must attack
  goadedBy?: string[]; // Player IDs who goaded this creature
  lure: boolean; // If creature must be blocked by all able creatures (Lure effect)
}

/**
 * Get creature info from a permanent, including effective P/T and danger indicators
 */
export function getCreatureInfo(perm: BattlefieldPermanent): { 
  name: string; 
  pt: string; 
  effectivePower: number | undefined;
  effectiveToughness: number | undefined;
  imageUrl?: string;
  dangers: DangerIndicators;
} {
  // Defensive check for undefined/null permanent
  if (!perm) {
    return { 
      name: 'Unknown', 
      pt: '?/?', 
      effectivePower: undefined, 
      effectiveToughness: undefined,
      imageUrl: undefined,
      dangers: { 
        deathtouch: false, 
        infect: false, 
        toxic: 0, 
        trample: false, 
        menace: false, 
        firstStrike: false, 
        doubleStrike: false, 
        lifelink: false, 
        indestructible: false,
        goaded: false,
        lure: false,
      }
    };
  }
  
  const card = perm.card as KnownCardRef | undefined;
  const name = card?.name || perm.id || 'Unknown';
  const combinedText = getCombinedPermanentText(perm);
  
  // Check for Lure effect - from the creature itself or from attached auras
  // Lure: "All creatures able to block enchanted creature do so"
  const hasLure = combinedText.includes('must be blocked') || 
                  combinedText.includes('all creatures able to block');
  
  // Use pre-calculated effective P/T if available
  let effectivePower = perm.effectivePower;
  let effectiveToughness = perm.effectiveToughness;
  
  // Fallback to manual calculation if not pre-calculated
  if (effectivePower === undefined || effectiveToughness === undefined) {
    let baseP: number | undefined;
    let baseT: number | undefined;
    
    try {
      if (perm.basePower !== undefined && perm.basePower !== null) {
        baseP = typeof perm.basePower === 'number' ? perm.basePower : parseInt(String(perm.basePower), 10);
        if (isNaN(baseP)) baseP = undefined;
      } else if (card?.power) {
        baseP = parseInt(String(card.power), 10);
        if (isNaN(baseP)) baseP = undefined;
      }
      
      if (perm.baseToughness !== undefined && perm.baseToughness !== null) {
        baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parseInt(String(perm.baseToughness), 10);
        if (isNaN(baseT)) baseT = undefined;
      } else if (card?.toughness) {
        baseT = parseInt(String(card.toughness), 10);
        if (isNaN(baseT)) baseT = undefined;
      }
    } catch {
      // Ignore parsing errors
    }
    
    const plusCounters = perm.counters?.['+1/+1'] ?? 0;
    const minusCounters = perm.counters?.['-1/-1'] ?? 0;
    const delta = plusCounters - minusCounters;
    
    effectivePower = typeof baseP === 'number' ? baseP + delta : undefined;
    effectiveToughness = typeof baseT === 'number' ? baseT + delta : undefined;
  }
  
  const p = effectivePower !== undefined ? effectivePower : '?';
  const t = effectiveToughness !== undefined ? effectiveToughness : '?';
  const pt = `${p}/${t}`;
  
  const imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
  
  const hasAbility = (keyword: string) => combinedText.includes(keyword);
  
  // Parse toxic value
  let toxicValue = 0;
  const toxicMatch = combinedText.match(/toxic\s+(\d+)/i);
  if (toxicMatch) {
    toxicValue = parseInt(toxicMatch[1], 10);
  }
  
  const dangers: DangerIndicators = {
    deathtouch: hasAbility('deathtouch'),
    infect: hasAbility('infect'),
    toxic: toxicValue,
    trample: hasAbility('trample'),
    menace: hasAbility('menace'),
    firstStrike: hasAbility('first strike') || hasAbility('first_strike'),
    doubleStrike: hasAbility('double strike') || hasAbility('double_strike'),
    lifelink: hasAbility('lifelink'),
    indestructible: hasAbility('indestructible'),
    goaded: isPermanentGoaded(perm),
    goadedBy: getPermanentGoaders(perm),
    lure: hasLure,
  };
  
  return { name, pt, effectivePower, effectiveToughness, imageUrl, dangers };
}
