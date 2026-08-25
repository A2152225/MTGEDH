// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: isCurrentlyCreature, hasDefender, canPermanentAttack, hasHaste,
// canPermanentBlock, checkEvasionAbilities, hasAbility, and exclusive helpers
// (canAttackAsThoughItDidntHaveDefender, getPermanentTypeLineLower,
// permanentHasLandSubtype, satisfiesDefendingPlayerLandAttackRestriction).
// Public entry symbols: isCurrentlyCreature, hasDefender, canPermanentAttack,
// hasHaste, canPermanentBlock, checkEvasionAbilities, CombatValidationResult.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

import { isCreatureTypeWord, permanentHasCreatureType } from '../../../../shared/src';
import { getLandwalkUnblockableReason } from '../../../../shared/src/combatLandwalk.js';
import { getIllegalDefendingPlayerRestriction, hasBlanketCantAttack } from '../../attackRestrictionText';
import { getCombinedPermanentText } from '../../permanentText';
import { isStationPermanentCreatureNow, isStationPermanentTypeLine } from '../../stationPermanentUtils';
import { getPermanentForGoadAnalysis } from './combatGoadPermanentLookup.js';
import { getPermanentPower } from './combatPermanentPower.js';

/**
 * Result of checking if a permanent can participate in combat
 */
export interface CombatValidationResult {
  readonly canParticipate: boolean;
  readonly reason?: string;
}

const DEFENDING_PLAYER_LAND_ATTACK_RESTRICTION_RE =
  /can(?:not|'t) attack unless defending player controls an? (plains|island|swamp|mountain|forest)\b/i;

/**
 * Check if a permanent is currently a creature (Rule 302)
 * This considers:
 * - Base type line
 * - Type-changing effects (e.g., Imprisoned in the Moon removes creature type)
 * - Animation effects (e.g., Tezzeret making artifacts creatures, Nissa animating lands)
 * - Granted types from effects
 * - Vehicles (only creatures when crewed this turn)
 * - Spacecraft / Planet with Station (creatures when charge counter threshold met)
 * - Bestow creatures (may be Auras when attached to another creature)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent is currently a creature
 */
export function isCurrentlyCreature(permanent: any): boolean {
  if (!permanent) return false;
  
  // Include cardType for executor fixtures that omit a full type_line.
  const typeLine = [
    permanent.cardType,
    permanent.card?.type_line,
    permanent.type_line,
  ]
    .map(value => String(value || '').toLowerCase().trim())
    .filter(Boolean)
    .join(' ');
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  
  // FIRST: Check for the notCreature flag - this is set by the game state
  // for Gods with insufficient devotion (Rule 704.5n - "Theros-style gods")
  // Example: Iroas, God of Victory is only a creature when devotion to red and white is 7+
  if (permanent.notCreature === true) {
    return false;
  }
  
  // SECOND: Check for the isCreature flag - this is set by animation effects
  // like Tezzeret, Karn, Nissa, March of the Machines, etc.
  // This takes highest priority as it represents the current game state
  if (permanent.isCreature === true) {
    return true;
  }

  // Processed battlefield snapshots may expose the final type set directly.
  // If present, treat this as authoritative current-state typing.
  if (Array.isArray(permanent.effectiveTypes) && permanent.effectiveTypes.length > 0) {
    return permanent.effectiveTypes.some((entry: unknown) => String(entry).toLowerCase() === 'creature');
  }
  
  // Check for animation modifiers (Tezzeret, Karn, Ensoul Artifact, etc.)
  // These effects turn non-creature permanents into creatures
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      // Animation effects that make something a creature
      if (mod.type === 'animation' || mod.type === 'ANIMATION' ||
          mod.type === 'becomesCreature' || mod.type === 'BECOMES_CREATURE' ||
          mod.type === 'tezzeret' || mod.type === 'ensoulArtifact' ||
          mod.type === 'marchOfTheMachines' || mod.type === 'nissaAnimation' ||
          mod.type === 'karnAnimation' || mod.type === 'manland') {
        // Check if the animation is still active
        if (mod.active !== false) {
          return true;
        }
      }
      
      // TYPE_CHANGE modifiers can add or remove types
      if (mod.type === 'typeChange' || mod.type === 'TYPE_CHANGE' || 
          mod.type === 'imprisonedInTheMoon' || mod.type === 'songOfTheDryads' ||
          mod.type === 'typeReplacement') {
        // If modifier explicitly removes creature type
        if (mod.removesTypes?.includes('Creature')) {
          return false;
        }
        // If modifier sets a new type line that replaces the original (e.g., "Land")
        // These effects turn the permanent into something else entirely
        if (mod.newTypeLine) {
          const newType = mod.newTypeLine.toLowerCase();
          // The new type line replaces all types - check if it includes creature
          return newType.includes('creature');
        }
        // If modifier adds creature type
        if (mod.addsTypes?.includes('Creature')) {
          return true;
        }
      }
    }
  }
  
  // Check if this permanent is marked as having its types replaced
  // (e.g., by Imprisoned in the Moon making it "just a land")
  if (permanent.typesReplaced === true) {
    // Check the current effective types
    if (permanent.effectiveTypes && Array.isArray(permanent.effectiveTypes)) {
      return permanent.effectiveTypes.includes('Creature');
    }
    // If types were replaced but no creature type, it's not a creature
    return false;
  }
  
  // Check for animated flag (used for lands that become creatures, artifacts animated by Tezzeret, etc.)
  if (permanent.animated === true) {
    return true;
  }
  
  // Handle Bestow creatures - they can be Auras when cast with bestow
  // A bestow creature on the battlefield is a creature UNLESS it's currently
  // attached to another permanent as an Aura
  if (oracleText.includes('bestow')) {
    // Check if this permanent is currently attached to something (acting as an Aura)
    if (permanent.attachedTo || permanent.enchanting) {
      // It's attached to something, so it's an Aura (Enchantment), not a Creature
      return false;
    }
    // If a bestow creature is on the battlefield unattached, it's a creature
    // (This happens when the enchanted creature dies)
    if (typeLine.includes('creature')) {
      return true;
    }
  }
  
  // Handle Vehicles - they are NOT creatures unless crewed this turn
  // Vehicles have "Artifact — Vehicle" type line and "Crew N" ability
  if (typeLine.includes('vehicle')) {
    // Check if the vehicle has been crewed this turn
    // The game should set a 'crewed' or 'isCreature' flag when crew is activated
    if (permanent.crewed === true) {
      return true;
    }
    // Also check for granted creature type from crew effect
    if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
      if (permanent.grantedTypes.includes('Creature')) return true;
    }
    // Vehicle not crewed - not a creature
    return false;
  }
  
  // Handle Spacecraft / Planet permanents with Station mechanic
  if (isStationPermanentTypeLine(typeLine)) {
    if (isStationPermanentCreatureNow(permanent, oracleText)) {
      return true;
    }
    return false;
  }
  
  // Check for explicit types array (from modifiers or card data)
  if (permanent.types && Array.isArray(permanent.types)) {
    if (permanent.types.includes('Creature')) return true;
  }
  
  // Check granted types from effects (e.g., "becomes a creature")
  if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
    if (permanent.grantedTypes.includes('Creature')) return true;
  }
  
  // Check if the base type line includes creature
  if (typeLine.includes('creature')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent has the defender keyword ability (Rule 702.3)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent has defender
 */
export function hasDefender(permanent: any): boolean {
  if (!permanent) return false;
  const combinedText = getCombinedPermanentText(permanent)
    .replace(/can attack(?: this turn)? as though it did(?:n't| not) have defender/gi, '');
  if (/(^|[\n,.;])\s*defender(?:\s*\([^)]*\))?(?=$|[\n,.;])/i.test(combinedText)) return true;
  
  // Preserve legacy fixture compatibility for tests that still encode
  // defender directly in type text or keyword arrays.
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  if (typeLine.includes('defender')) {
    return true;
  }

  if (permanent.keywords && Array.isArray(permanent.keywords)) {
    if (permanent.keywords.some((keyword: string) => keyword.toLowerCase() === 'defender')) {
      return true;
    }
  }
  
  // Check granted abilities
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === 'defender')) {
      return true;
    }
  }
  
  // Check modifiers for granted defender
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'abilityGrant' || mod.type === 'ABILITY_GRANT') {
        if (mod.ability?.toLowerCase() === 'defender') return true;
      }
    }
  }
  
  // Check abilities array if present
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type === 'defender' || a.name?.toLowerCase() === 'defender'
    )) {
      return true;
    }
  }
  
  return false;
}

function canAttackAsThoughItDidntHaveDefender(permanent: any): boolean {
  if (!permanent) return false;
  return /can attack(?: this turn)? as though it did(?:n't| not) have defender/i.test(
    getCombinedPermanentText(permanent)
  );
}

export function getPermanentTypeLineLower(permanent: any): string {
  return [
    permanent?.card?.type_line,
    permanent?.type_line,
    permanent?.cardType,
    Array.isArray(permanent?.effectiveTypes) ? permanent.effectiveTypes.join(' ') : '',
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function permanentHasLandSubtype(permanent: any, subtype: string): boolean {
  const typeLine = getPermanentTypeLineLower(permanent);
  if (!typeLine.includes('land')) return false;

  return new RegExp(`(^|[^a-z])${String(subtype || '').trim().toLowerCase()}($|[^a-z])`, 'i').test(typeLine);
}

function satisfiesDefendingPlayerLandAttackRestriction(
  battlefield: readonly any[] | undefined,
  controllerId: string | undefined,
  defendingPlayerId: string | undefined,
  requiredSubtype: string,
): boolean {
  const permanents = Array.isArray(battlefield) ? battlefield : [];
  const normalizedControllerId = String(controllerId || '').trim();
  const normalizedDefendingPlayerId = String(defendingPlayerId || '').trim();

  const candidateDefenders = normalizedDefendingPlayerId
    ? [normalizedDefendingPlayerId]
    : Array.from(
        new Set(
          permanents
            .map((perm: any) => String(perm?.controller || '').trim())
            .filter((playerId) => Boolean(playerId) && playerId !== normalizedControllerId),
        ),
      );

  return candidateDefenders.some((playerId) =>
    permanents.some(
      (perm: any) =>
        String(perm?.controller || '').trim() === playerId &&
        permanentHasLandSubtype(perm, requiredSubtype),
    ),
  );
}

/**
 * Check if a permanent has a "can't attack" restriction
 * This includes:
 * - Defender keyword (Rule 702.3)
 * - Effects that say "can't attack" (e.g., Pacifism, Arrest)
 * - Creature is tapped
 * - Summoning sickness (Rule 302.6)
 * 
 * @param permanent - The permanent to check
 * @param controllerId - The controller's player ID
 * @param defendingPlayerId - Optional defending player for defender-dependent attack restrictions
 * @returns CombatValidationResult with canParticipate and reason
 */
export function canPermanentAttack(
  permanent: any,
  controllerId?: string,
  battlefield?: any[],
  defendingPlayerId?: string,
): CombatValidationResult {
  if (!permanent) {
    return { canParticipate: false, reason: 'Permanent not found' };
  }

  const analyzedPermanent = getPermanentForGoadAnalysis(permanent, battlefield);
  
  // Must be a creature to attack (Rule 508.1a)
  if (!isCurrentlyCreature(analyzedPermanent)) {
    return { canParticipate: false, reason: 'Only creatures can attack' };
  }
  
  // Cannot attack if tapped (Rule 508.1a)
  if (analyzedPermanent.tapped) {
    return { canParticipate: false, reason: 'Cannot attack with tapped creature' };
  }
  
  // Cannot attack with defender (Rule 702.3b)
  if (hasDefender(analyzedPermanent) && !canAttackAsThoughItDidntHaveDefender(analyzedPermanent)) {
    return { canParticipate: false, reason: 'Creatures with defender cannot attack' };
  }
  
  // Check for summoning sickness (Rule 302.6)
  // A creature can't attack unless it has been under its controller's 
  // control continuously since the beginning of their most recent turn
  if (analyzedPermanent.summoningSickness || analyzedPermanent.summmoningSickness) {
    // Check for haste which bypasses summoning sickness
    if (!hasHaste(analyzedPermanent)) {
      return { canParticipate: false, reason: 'Creature has summoning sickness' };
    }
  }
  
  // Check for "can't attack" modifiers (e.g., Pacifism, Arrest)
  if (analyzedPermanent.modifiers && Array.isArray(analyzedPermanent.modifiers)) {
    for (const mod of analyzedPermanent.modifiers) {
      if (mod.type === 'cantAttack' || mod.type === 'CANT_ATTACK') {
        return { canParticipate: false, reason: mod.reason || 'This creature cannot attack' };
      }
    }
  }

  if (defendingPlayerId && (analyzedPermanent as any).cantAttackPlayers?.[defendingPlayerId]) {
    return {
      canParticipate: false,
      reason: "This creature can't attack that player until that player's next turn",
    };
  }

  const ownerRestriction = getIllegalDefendingPlayerRestriction({
    oracleText: getCombinedPermanentText(analyzedPermanent),
    ownerId: analyzedPermanent.owner || analyzedPermanent.ownerId,
    controllerId: controllerId || analyzedPermanent.controller,
    defendingPlayerId,
    cantAttackOwner: Boolean((analyzedPermanent as any).cantAttackOwner),
  });
  if (ownerRestriction.illegal) {
    return { canParticipate: false, reason: ownerRestriction.reason };
  }
  
  // Check oracle text for "can't attack" effects on attached auras/equipment
  const oracleText = getCombinedPermanentText(analyzedPermanent);
  const defendingPlayerLandRestriction = oracleText.match(DEFENDING_PLAYER_LAND_ATTACK_RESTRICTION_RE);
  if (defendingPlayerLandRestriction) {
    const requiredSubtype = String(defendingPlayerLandRestriction[1] || '').trim().toLowerCase();
    if (
      requiredSubtype &&
      !satisfiesDefendingPlayerLandAttackRestriction(battlefield, controllerId, defendingPlayerId, requiredSubtype)
    ) {
      const article = /^[aeiou]/i.test(requiredSubtype) ? 'an' : 'a';
      return {
        canParticipate: false,
        reason: `This creature can't attack unless defending player controls ${article} ${requiredSubtype}`,
      };
    }
  }

  const genericCantAttackText = oracleText.replace(DEFENDING_PLAYER_LAND_ATTACK_RESTRICTION_RE, '');
  if (hasBlanketCantAttack(genericCantAttackText)) {
    return { canParticipate: false, reason: 'This creature cannot attack' };
  }
  
  return { canParticipate: true };
}

/**
 * Check if a permanent has the haste keyword ability (Rule 702.10)
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent has haste
 */
export function hasHaste(permanent: any): boolean {
  if (!permanent) return false;
  const combinedText = getCombinedPermanentText(permanent);
  if (combinedText.includes('haste')) return true;
  
  // Check granted abilities
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === 'haste')) {
      return true;
    }
  }
  
  // Check modifiers for granted haste
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'abilityGrant' || mod.type === 'ABILITY_GRANT') {
        if (mod.ability?.toLowerCase() === 'haste') return true;
      }
    }
  }
  
  // Check abilities array if present
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type === 'haste' || a.name?.toLowerCase() === 'haste'
    )) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a permanent has a "can't block" restriction
 * This includes:
 * - Effects that say "can't block" (e.g., Cobblebrute, Goblin Heelcutter)
 * - Creature is tapped
 * - Shadow/fear/menace/flying restrictions (vs specific attackers)
 * 
 * @param permanent - The permanent to check
 * @param attacker - The attacking creature (optional, for evasion checks)
 * @returns CombatValidationResult with canParticipate and reason
 */
/**
 * Check if a permanent has a "can't block" restriction
 * This includes:
 * - Effects that say "can't block" (e.g., Cobblebrute, Goblin Heelcutter)
 * - Creature is tapped
 * - Shadow/fear/menace/flying restrictions (vs specific attackers)
 * 
 * @param permanent - The permanent to check
 * @param attacker - The attacking creature (optional, for evasion checks)
 * @param battlefield - The battlefield array (optional, for granted abilities check)
 * @returns CombatValidationResult with canParticipate and reason
 */
export function canPermanentBlock(permanent: any, attacker?: any, battlefield?: any[]): CombatValidationResult {
  if (!permanent) {
    return { canParticipate: false, reason: 'Permanent not found' };
  }

  const analyzedPermanent = getPermanentForGoadAnalysis(permanent, battlefield);
  const analyzedAttacker = attacker ? getPermanentForGoadAnalysis(attacker, battlefield) : attacker;
  
  // Must be a creature to block (Rule 509.1a)
  if (!isCurrentlyCreature(analyzedPermanent)) {
    return { canParticipate: false, reason: 'Only creatures can block' };
  }
  
  // Cannot block if tapped (Rule 509.1a)
  if (analyzedPermanent.tapped) {
    return { canParticipate: false, reason: 'Cannot block with tapped creature' };
  }
  
  // Check for "can't block" modifiers
  if (analyzedPermanent.modifiers && Array.isArray(analyzedPermanent.modifiers)) {
    for (const mod of analyzedPermanent.modifiers) {
      if (mod.type === 'cantBlock' || mod.type === 'CANT_BLOCK') {
        return { canParticipate: false, reason: mod.reason || 'This creature cannot block' };
      }
    }
  }
  
  // Check oracle text for "can't block" self-restrictions
  const oracleText = getCombinedPermanentText(analyzedPermanent);
  if (oracleText.includes("can't block") && !oracleText.includes("can't be blocked")) {
    // Check if it's a self-restriction (simple cases)
    // Full implementation would parse the oracle text more carefully
    if (!oracleText.includes("can't block creatures") && 
        !oracleText.includes("can't block except")) {
      return { canParticipate: false, reason: 'This creature cannot block' };
    }
  }

  if (attacker && oracleText.includes('can block only creatures with flying')) {
    const attackerText = getCombinedPermanentText(analyzedAttacker);
    if (!attackerText.includes('flying') && !hasAbility(analyzedAttacker, 'flying', battlefield)) {
      return { canParticipate: false, reason: 'This creature can block only creatures with flying' };
    }
  }
  
  // If an attacker is provided, check evasion abilities (flying, shadow, etc.)
  if (analyzedAttacker) {
    const evasionResult = checkEvasionAbilities(analyzedPermanent, analyzedAttacker, battlefield);
    if (!evasionResult.canParticipate) {
      return evasionResult;
    }
  }
  
  return { canParticipate: true };
}

/**
 * Check evasion abilities when blocking
 * Flying, shadow, horsemanship, menace, fear, intimidate, skulk, etc.
 * 
 * @param blocker - The potential blocking creature
 * @param attacker - The attacking creature
 * @returns CombatValidationResult
 */
/**
 * Check evasion abilities when blocking
 * Flying, shadow, horsemanship, menace, fear, intimidate, skulk, etc.
 * 
 * @param blocker - The potential blocking creature
 * @param attacker - The attacking creature
 * @param battlefield - The battlefield array (for checking granted abilities)
 * @returns CombatValidationResult
 */
export function checkEvasionAbilities(blocker: any, attacker: any, battlefield?: any[]): CombatValidationResult {
  const attackerText = getCombinedPermanentText(attacker);
  const blockerText = getCombinedPermanentText(blocker);

  const landwalkReason = getLandwalkUnblockableReason(
    attacker,
    blocker?.controller,
    Array.isArray(battlefield) ? battlefield : [],
  );
  if (landwalkReason) {
    return { canParticipate: false, reason: landwalkReason };
  }
  
  // Flying (Rule 702.9) - can only be blocked by creatures with flying or reach
  if (attackerText.includes('flying') || hasAbility(attacker, 'flying', battlefield)) {
    if (!attackerText.includes('reach') && !hasAbility(blocker, 'reach', battlefield) &&
        !blockerText.includes('flying') && !hasAbility(blocker, 'flying', battlefield)) {
      return { canParticipate: false, reason: 'Cannot block a creature with flying without flying or reach' };
    }
  }
  
  // Shadow (Rule 702.27) - can only be blocked by creatures with shadow
  if (attackerText.includes('shadow') || hasAbility(attacker, 'shadow', battlefield)) {
    if (!blockerText.includes('shadow') && !hasAbility(blocker, 'shadow', battlefield)) {
      return { canParticipate: false, reason: 'Only creatures with shadow can block creatures with shadow' };
    }
  }
  
  // Horsemanship (Rule 702.30) - can only be blocked by creatures with horsemanship
  if (attackerText.includes('horsemanship') || hasAbility(attacker, 'horsemanship', battlefield)) {
    if (!blockerText.includes('horsemanship') && !hasAbility(blocker, 'horsemanship', battlefield)) {
      return { canParticipate: false, reason: 'Only creatures with horsemanship can block creatures with horsemanship' };
    }
  }

  if (attackerText.includes("can't be blocked by creatures with power 2 or less")) {
    const blockerPower = getPermanentPower(blocker);
    if (blockerPower <= 2) {
      return { canParticipate: false, reason: 'This attacker cannot be blocked by creatures with power 2 or less' };
    }
  }

  if (attackerText.includes("can't be blocked by creatures with greater power")) {
    const blockerPower = getPermanentPower(blocker);
    const attackerPower = getPermanentPower(attacker);
    if (blockerPower > attackerPower) {
      return { canParticipate: false, reason: 'This attacker cannot be blocked by creatures with greater power' };
    }
  }

  if (/creatures with power less than (?:this creature|~|[a-z0-9', -]+)'?s power can(?:'|')?t block (?:it|this creature|~)/i.test(attackerText)) {
    const blockerPower = getPermanentPower(blocker);
    const attackerPower = getPermanentPower(attacker);
    if (blockerPower < attackerPower) {
      return { canParticipate: false, reason: 'Creatures with lesser power cannot block this attacker' };
    }
  }

  if (
    attackerText.includes("can't be blocked this turn") ||
    /\bcan't be blocked\b(?!\s+by)(?:$|[\n,.;])/.test(attackerText)
  ) {
    return { canParticipate: false, reason: 'This creature cannot block that attacker' };
  }
  
  return { canParticipate: true };
}

/**
 * Helper to check if a permanent has a specific ability
 */
export function hasAbility(permanent: any, abilityName: string, battlefield?: any[]): boolean {
  if (!permanent) return false;
  
  const lowerName = abilityName.toLowerCase();
  const oracleText = getCombinedPermanentText(permanent);

  if (oracleText.includes(lowerName)) {
    return true;
  }
  
  // Check granted abilities stored on the permanent
  if (permanent.grantedAbilities && Array.isArray(permanent.grantedAbilities)) {
    if (permanent.grantedAbilities.some((a: string) => a.toLowerCase() === lowerName)) {
      return true;
    }
  }
  
  // Check abilities array
  if (permanent.abilities && Array.isArray(permanent.abilities)) {
    if (permanent.abilities.some((a: any) => 
      a.type?.toLowerCase() === lowerName || a.name?.toLowerCase() === lowerName
    )) {
      return true;
    }
  }
  
  // Check keywords array from card data
  if (permanent.card?.keywords && Array.isArray(permanent.card.keywords)) {
    if (permanent.card.keywords.some((k: string) => k.toLowerCase() === lowerName)) {
      return true;
    }
  }
  
  // Check for abilities granted by other battlefield permanents
  // This is for effects like Eldrazi Monument ("creatures you control have flying and indestructible")
  if (battlefield && Array.isArray(battlefield)) {
    const isCreature = isCurrentlyCreature(permanent);
    
    for (const source of battlefield) {
      if (!source || !source.card) continue;
      
      const sourceOracle = (source.card.oracle_text || '').toLowerCase();
      const sourceController = source.controller;
      
      // Pattern: "creatures you control have [ability]" or "creatures you control get +X/+X and have [ability]"
      // This handles Eldrazi Monument, anthem effects, etc.
      if (isCreature && sourceController === permanent.controller) {
        const typedGrantPattern = new RegExp(
          `(?:^|[.\\n;])\\s*(?!other\\s)([a-z]+)\\s+creatures\\s+you\\s+control\\s+(?:get\\s+[+\\-]\\d+/[+\\-]\\d+\\s+and\\s+)?have\\s+[^.]*\\b${lowerName}\\b`,
          'i',
        );
        const typedGrant = sourceOracle.match(typedGrantPattern);
        if (typedGrant) {
          const qualifier = String(typedGrant[1] || '').toLowerCase();
          const colorCode = ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as Record<string, string>)[qualifier];
          if (colorCode) {
            const colors = (permanent.card?.colors || permanent.colors || []) as unknown[];
            if (colors.some((entry) => {
              const value = String(entry || '');
              return value.toUpperCase() === colorCode || value.toLowerCase() === qualifier;
            })) {
              return true;
            }
          } else if (isCreatureTypeWord(qualifier) && permanentHasCreatureType(permanent, qualifier)) {
            return true;
          }
        }

        // Pattern: "creatures you control have [ability]" or "creatures you control get +X/+X and have [ability]"
        // This handles Eldrazi Monument, anthem effects, etc.
        const grantPattern = new RegExp(`(?<![a-z] )(?:all\\s+)?creatures\\s+you\\s+control\\s+(?:get\\s+[+\\-]\\d+/[+\\-]\\d+\\s+and\\s+)?have\\s+[^.]*\\b${lowerName}\\b`, 'i');
        if (grantPattern.test(sourceOracle)) {
          return true;
        }
        
        // Pattern: "other creatures you control have [ability]"
        const otherPattern = new RegExp(`other\\s+creatures\\s+you\\s+control\\s+(?:get\\s+[+\\-]\\d+/[+\\-]\\d+\\s+and\\s+)?have\\s+[^.]*\\b${lowerName}\\b`, 'i');
        if (otherPattern.test(sourceOracle) && source.id !== permanent.id) {
          return true;
        }
      }
    }
  }
  
  return false;
}
