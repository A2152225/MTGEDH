/**
 * Keyword-cost activated abilities split out of parseActivatedAbilities:
 * level up, outlast, boast, monstrosity, adapt and fortify.
 */
import type { KnownCardRef } from '../../../../shared/src';
import type { ParsedActivatedAbility } from './activatedAbilityParserTypes';

/** Appends keyword-cost abilities; returns the next ability index. */
export function appendKeywordCostAbilities(
  abilities: ParsedActivatedAbility[],
  card: KnownCardRef,
  oracleText: string,
  typeLine: string,
  startIndex: number,
): number {
  let abilityIndex = startIndex;
  const name = card.name || '';
  // ======== LEVEL UP ABILITIES (Rule 702.87) ========
  // "Level up [cost]" means "[Cost]: Put a level counter on this permanent. Activate only as a sorcery."
  const levelUpMatch = oracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (levelUpMatch) {
    const levelUpCost = levelUpMatch[1];
    abilities.push({
      id: `${card.id}-level-up-${abilityIndex++}`,
      label: `Level Up ${levelUpCost}`,
      description: 'Put a level counter on this permanent (sorcery speed)',
      cost: levelUpCost,
      effect: 'Put a level counter on this permanent',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: levelUpCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery', // Level up is sorcery speed only
    });
  }
  
  // ======== OUTLAST ABILITIES (Rule 702.107) ========
  // "Outlast [cost]" means "[Cost], {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery."
  // Example oracle text: "Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)"
  const outlastMatch = oracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (outlastMatch) {
    const outlastCost = outlastMatch[1];
    abilities.push({
      id: `${card.id}-outlast-${abilityIndex++}`,
      label: `Outlast ${outlastCost}`,
      description: 'Put a +1/+1 counter on this creature (sorcery speed, tap)',
      cost: `${outlastCost}, {T}`,
      effect: 'Put a +1/+1 counter on this creature',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: outlastCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery', // Outlast is sorcery speed only (Rule 702.107a)
    });
  }
  
  // ======== BOAST ABILITIES (Rule 702.142) ========
  // "Boast — [Cost]: [Effect]" - Activate only if creature attacked this turn and only once each turn
  // Example: "Boast — {1}{R}: Create a Treasure token."
  const boastMatch = oracleText.match(/boast\s*[—-]\s*(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*([^.]+)/i);
  if (boastMatch) {
    const boastCost = boastMatch[1];
    const boastEffect = boastMatch[2].trim();
    abilities.push({
      id: `${card.id}-boast-${abilityIndex++}`,
      label: `Boast ${boastCost}`,
      description: `${boastEffect} (only if attacked this turn, once per turn)`,
      cost: boastCost,
      effect: boastEffect,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: boastCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      oncePerTurn: true,
    });
  }
  
  // ======== MONSTROSITY ABILITIES (Rule 702.94) ========
  // "{cost}: Monstrosity N" - Put N +1/+1 counters on this creature (if not monstrous)
  // Example: "Monstrosity 3" or "{5}{G}{G}: Monstrosity 3"
  const monstrosityMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
  if (monstrosityMatch) {
    const monstrosityCost = monstrosityMatch[1];
    const monstrosityN = parseInt(monstrosityMatch[2], 10);
    abilities.push({
      id: `${card.id}-monstrosity-${abilityIndex++}`,
      label: `Monstrosity ${monstrosityN}`,
      description: `Put ${monstrosityN} +1/+1 counter${monstrosityN !== 1 ? 's' : ''} on ${name} (can only be activated if not monstrous)`,
      cost: monstrosityCost,
      effect: `Put ${monstrosityN} +1/+1 counter${monstrosityN !== 1 ? 's' : ''} on this creature. It becomes monstrous.`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: monstrosityCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== ADAPT ABILITIES (Rule 702.140) ========
  // "{cost}: Adapt N" - Put N +1/+1 counters if no +1/+1 counters on it
  // Example: "{1}{G}{U}: Adapt 2"
  const adaptMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
  if (adaptMatch) {
    const adaptCost = adaptMatch[1];
    const adaptN = parseInt(adaptMatch[2], 10);
    abilities.push({
      id: `${card.id}-adapt-${abilityIndex++}`,
      label: `Adapt ${adaptN}`,
      description: `Put ${adaptN} +1/+1 counter${adaptN !== 1 ? 's' : ''} on ${name} (only if it has no +1/+1 counters)`,
      cost: adaptCost,
      effect: `Put ${adaptN} +1/+1 counter${adaptN !== 1 ? 's' : ''} on this creature if it has no +1/+1 counters on it.`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: adaptCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== FORTIFY ABILITIES (Rule 702.67) ========
  // "Fortify {cost}" - Attach Fortification to target land you control (sorcery speed)
  // Example: "Fortify {3}"
  const fortifyMatch = oracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (fortifyMatch && typeLine.toLowerCase().includes('fortification')) {
    const fortifyCost = fortifyMatch[1];
    abilities.push({
      id: `${card.id}-fortify-${abilityIndex++}`,
      label: `Fortify ${fortifyCost}`,
      description: 'Attach to target land you control (sorcery speed)',
      cost: fortifyCost,
      effect: 'Attach this Fortification to target land you control',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: fortifyCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: true,
      targetDescription: 'land you control',
    });
  }
  return abilityIndex;
}
