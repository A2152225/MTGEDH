// server/src/socket/combat-handlers/combatLegalityGates.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: the pure predicate layer that decides whether a permanent is a
// creature right now and whether it may legally attack or block - devotion/vehicle/
// station/bestow creature checks, effective-ability lookup (granted, removed,
// "as though"), temporary combat restriction texts, and the controlled-creature
// combat gate.
// Public entry symbols: isCurrentlyCreature, hasEffectiveAbility,
//   getTemporaryCombatAbilityTexts, isFullyUnblockableRestriction,
//   getOracleTextForCombatGate, getControlledCreatureGateViolationForPermanent,
//   canPermanentAttack, canBlockAttacker.
// These stay module-private to combat.ts (imported there, not re-exported).

import { moreCreaturesBlockRestrictionReason } from "./combatBatch33AttackRestrictions.js"; // B33
import { artifactOrColorBlockOnlyReason } from "./combatBatch31BlockRestrictions.js"; // B31
import {
  isStationPermanentCreatureNow,
  isStationPermanentTypeLine,
} from "../../../../rules-engine/src/stationPermanentUtils.js";
import { getLandwalkUnblockableReason } from "../../../../shared/src/combatLandwalk.js";
import { countDevotionAmongPermanents } from "../../../../shared/src/devotionCount.js";
import { isCreatureTypeWord, permanentHasCreatureType } from "../../../../shared/src/creatureTypes.js";
import {
  isCounterPreventingAttack,
  isCounterPreventingBlock,
} from "../../../../shared/src/counterCombatRestrictions.js";
import {
  countControlledCreaturesForCombatGate,
  getControlledCreatureCombatGateViolation,
  parseControlledCreatureCombatGate,
} from "../../../../shared/src/controlledCreatureCombatGate.js";
import { sanitizeOracleTextForStaticEffectScan } from "../../../../rules-engine/src/staticEffectOracleSanitize.js";
import { protectionPreventsSource } from "../../state/modules/combat-mechanics.js";
import { getContinuousGrantedAbilitiesForPermanent } from "../../state/modules/staticEffectSpec.js";
import { blockerCantBlockCreaturesYouControl } from "../../state/modules/staticEffectSpecAttackYouTax.js";
import { getEffectivePower, getEffectiveToughness } from "../util.js";
import { getColorBlockRestrictionReason } from "./combatColorBlockRestriction.js";
import { getExceptColorBlockRestrictionReason } from './combatExceptColorBlockRestriction.js';
import { getQualifierBlockRestrictionReason } from "./combatQualifierBlockRestriction.js";
import { getBatch25BlockRestrictionReason } from "./combatBatch25BlockRestrictions.js";
import { canBlockAsThoughReach } from "./combatBatch26BlockRestrictions.js";
import { conditionalUnblockableReason } from "./combatBatch28ConditionalUnblockable.js"; // B28
import { attachedBlockOnlyFlyingReason } from "./combatBatch30AttachedBlockRestrictions.js"; // B30
import { canAttackDespiteDefender as canAttackDespiteDefenderFn, cowardsCantBlockWarriorsReason } from "./combatDefenderAttackPermission.js";
import { debug } from "../../utils/debug.js";
import { canBlockShadowAsThough } from "../../state/modules/blockAsThoughShadow.js";
import { permanentHasKeywordAbility, permanentLosesKeyword } from "../../../../rules-engine/src/permanentKeywordAbilities.js";

/**
 * Check if a permanent is currently a creature (Rule 302)
 * This considers:
 * - Base type line
 * - Type-changing effects (Imprisoned in the Moon, Song of the Dryads, etc.)
 * - Animation effects (e.g., Tezzeret making artifacts creatures, Nissa animating lands)
 * - Granted types from effects
 * - Vehicles (only creatures when crewed this turn)
 * - Spacecraft / Planet with Station (creatures when charge counter threshold met)
 * - Bestow creatures (may be Auras when attached to another creature)
 * - Gods with devotion requirements
 * 
 * Note: This does NOT handle "can't attack" effects like Defang or Pacifism,
 * which are checked separately in the attack validation.
 * 
 * NOTE: This function is intentionally duplicated from rules-engine/src/actions/combat.ts
 * to avoid circular dependencies. Keep both versions in sync when making changes.
 * 
 * @param permanent - The permanent to check
 * @param battlefield - Optional battlefield array for devotion calculations
 * @param controllerId - Optional controller ID for filtering battlefield by controller
 * @returns true if the permanent is currently a creature
 */
export function isCurrentlyCreature(permanent: any, battlefield?: any[], controllerId?: string): boolean {
  if (!permanent) return false;

  // A face-down permanent is a 2/2 creature with no abilities (CR 708.2), so a
  // notCreature stamp from its face-up text does not apply. Turn-face-down used
  // to leave only effectiveTypes and a nameless stub: the board showed the
  // stack_ id and this check rejected the attack.
  if (
    permanent.isFaceDown === true
    || permanent.card?.faceDown === true
    || permanent.card?.isFaceDownStub === true
    || permanent.faceDownType
  ) {
    return true;
  }

  if (permanent.notCreature === true) return false;
  
  // Check type_line from card data
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  
  // FIRST: Check for the isCreature flag - this is set by animation effects
  // like Tezzeret, Karn, Nissa, March of the Machines, etc.
  // This takes highest priority as it represents the current game state
  if (permanent.isCreature === true) {
    return true;
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
    // The game should set a 'crewed' flag when crew is activated
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
    // Station permanent not yet a creature
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
  
  // Handle Gods - they are only creatures if devotion threshold is met
  // Theros gods like Purphoros require devotion to their color(s) >= a threshold
  // Oracle text pattern: "As long as your devotion to [color] is less than [N], ~ isn't a creature"
  // Note: N can be a digit OR a word (e.g., "seven" for Iroas)
  if (typeLine.includes('god') && typeLine.includes('creature')) {
    // Check if this is a Theros-style god with devotion requirement
    // Support both digit and word numbers (five, six, seven, etc.)
    const devotionMatch = oracleText.match(/devotion to (\w+)(?:\s+and\s+(\w+))? is less than (\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
    if (devotionMatch) {
      const color1 = devotionMatch[1].toLowerCase();
      const color2 = devotionMatch[2]?.toLowerCase();
      const thresholdStr = devotionMatch[3].toLowerCase();
      
      // Convert word numbers to digits
      const wordToNumber: Record<string, number> = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      const parsedInt = parseInt(thresholdStr, 10);
      const threshold = wordToNumber[thresholdStr] ?? (isNaN(parsedInt) ? 5 : parsedInt);
      
      // Calculate devotion from permanents controlled by the same player
      // Use the passed battlefield parameter if available, otherwise use permanent.controllerBattlefield
      const controller = controllerId || permanent.controller;
      const playerPerms = battlefield 
        ? battlefield.filter((p: any) => p && p.controller === controller)
        : (permanent.controllerBattlefield || []);
      
      // Map color words to mana symbols
      const colorToSymbol: Record<string, string> = {
        'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G'
      };
      const symbol1 = colorToSymbol[color1] || color1.charAt(0).toUpperCase();
      const symbol2 = color2 ? (colorToSymbol[color2] || color2.charAt(0).toUpperCase()) : null;
      
      let devotion = countDevotionAmongPermanents(
        playerPerms,
        String(controller || ''),
        symbol2 ? [symbol1, symbol2] : [symbol1],
      );
      
      // Check if there's a stored devotion value on the permanent (from game state)
      if (permanent.calculatedDevotion !== undefined) {
        devotion = permanent.calculatedDevotion;
      }
      
      // If devotion is less than threshold, it's not a creature
      if (devotion < threshold) {
        debug(2, `[isCurrentlyCreature] God ${permanent.card?.name} does not meet devotion threshold: ${devotion} < ${threshold} (${color1}${color2 ? ` and ${color2}` : ''})`);
        return false;
      }
      // Devotion met - it IS a creature
      debug(2, `[isCurrentlyCreature] God ${permanent.card?.name} meets devotion threshold: ${devotion} >= ${threshold}`);
      return true;
    }
  }
  
  // Check if the base type line includes creature
  if (typeLine.includes('creature')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent effectively has a specific ability.
 * This considers:
 * - Base oracle text keywords
 * - Keywords array from card data
 * - Granted abilities from effects (grantedAbilities array)
 * - Removed abilities from effects (removedAbilities array)
 * - "As though" effects from other permanents
 * 
 * @param permanent - The permanent to check
 * @param ability - The ability to check for (lowercase, e.g., 'flying', 'reach', 'defender')
 * @param battlefield - All permanents on the battlefield (for checking global effects)
 * @param controllerId - The controller's player ID (for checking "you control" effects)
 * @returns Object with hasAbility flag and whether it's granted/removed
 */
export function hasEffectiveAbility(
  permanent: any,
  ability: string,
  battlefield: any[] = [],
  controllerId?: string
): { hasAbility: boolean; isGranted: boolean; isRemoved: boolean; asThough: boolean } {
  const lowerAbility = ability.toLowerCase();
  const oracleText = (permanent?.card?.oracle_text || '').toLowerCase();
  const rawKeywords = permanent?.card?.keywords;
  const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
  const grantedAbilities = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  const removedAbilities = Array.isArray(permanent?.removedAbilities) ? permanent.removedAbilities : [];
  
  // Keywords come from the shared accurate helper (keyword lines, Scryfall keywords, grants,
  // counters, equipment/auras, lords, "loses X") - never a substring of the oracle text, so
  // "Destroy target creature with flying" does not make a ground creature a flyer.
  const isRemoved = removedAbilities.some((a: string) => String(a).toLowerCase() === lowerAbility)
    || permanentLosesKeyword(permanent, lowerAbility, battlefield);
  const hasBaseAbility = permanentHasKeywordAbility(
    isRemoved ? { ...permanent, removedAbilities: [], removedKeywords: [] } : permanent,
    lowerAbility,
    isRemoved ? [] : battlefield,
  );
  const isGranted = grantedAbilities.some((a: string) => String(a).toLowerCase() === lowerAbility);

  // Check for "as though it had [ability]" effects from other permanents
  let asThough = false;
  if (battlefield.length > 0) {
    for (const perm of battlefield) {
      if (!perm.card?.oracle_text) continue;
      const permOracle = sanitizeOracleTextForStaticEffectScan(perm.card.oracle_text).toLowerCase();
      const permController = perm.controller;
      
      // Pattern: "as though they had [ability]" or "as though it had [ability]"
      // Examples: 
      // - Bower Passage: "Creatures you control can't be blocked by creatures with flying."
      // - Archetype of Courage: "Creatures you control have first strike. Creatures your opponents control lose first strike and can't have or gain first strike."
      // - Behind the Scenes: "Creatures you control have skulk."
      
      // Check for "as though" granting this specific ability
      const asThoughPattern = new RegExp(`as though (?:it|they) had ${lowerAbility}`, 'i');
      // "~ can block Dragons as though it had reach" is a subtype-limited block permission
      // (canBlockAsThoughReach), not the ability itself.
      const subtypeLimited = new RegExp(`can block (?!creatures\\b)[a-z]+ as though (?:it|they) had ${lowerAbility}`, 'i').test(permOracle);
      if (!subtypeLimited && asThoughPattern.test(permOracle)) {
        // Check if this effect applies to this permanent
        // Most "as though" effects are for "creatures you control"
        if (permOracle.includes('you control') && permController === controllerId) {
          asThough = true;
        } else if (!permOracle.includes('you control') && !permOracle.includes('opponents control')) {
          asThough = true; // Global effect
        }
      }
      
    }
  }
  
  // Final determination
  if (isRemoved) {
    // If explicitly removed, check if there's an "as though" override
    return { hasAbility: asThough, isGranted: false, isRemoved: true, asThough };
  }
  
  const hasAbility = hasBaseAbility || asThough;
  return { hasAbility, isGranted, isRemoved: false, asThough };
}

export function getTemporaryCombatAbilityTexts(permanent: any): string[] {
  return [
    ...(Array.isArray(permanent?.tempAbilities) ? permanent.tempAbilities : []),
    ...(Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []),
    ...(Array.isArray(permanent?.temporaryAbilities) ? permanent.temporaryAbilities : []),
    ...(Array.isArray(permanent?.temporaryEffects) ? permanent.temporaryEffects : []),
  ]
    .map((entry: any) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        if (typeof entry.ability === 'string') return entry.ability;
        if (typeof entry.description === 'string') return entry.description;
      }
      return '';
    })
    .map((entry: string) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isFullyUnblockableRestriction(entry: string): boolean {
  const normalized = String(entry || '')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.]$/, '')
    .trim()
    .toLowerCase();

  if (normalized === 'unblockable') {
    return true;
  }

  return /^(?:(?:it|this creature) )?(?:can't|cannot) be blocked(?: this turn)?$/.test(normalized);
}

/**
 * Check if a permanent can attack (checking for defender and "as though it didn't have defender" effects)
 * 
 * @param permanent - The permanent to check
 * @param battlefield - All permanents on the battlefield
 * @param controllerId - The controller's player ID
 * @returns Object with canAttack flag and reason if blocked
 */

export function getOracleTextForCombatGate(permanent: any): string {
  return [
    String(permanent?.card?.oracle_text || ''),
    String(permanent?.oracle_text || ''),
    Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities.join('\n') : '',
  ].join('\n');
}

export function getControlledCreatureGateViolationForPermanent(
  permanent: any,
  battlefield: any[] = [],
  controllerId: string | undefined,
  action: 'attack' | 'block',
): { illegal: boolean; reason?: string } {
  const oracleText = getOracleTextForCombatGate(permanent);
  const gate = parseControlledCreatureCombatGate(oracleText);
  if (!gate) return { illegal: false };

  const pid = String(controllerId || permanent?.controller || '').trim();
  const controlledCount = countControlledCreaturesForCombatGate({
    battlefield,
    controllerId: pid,
    isCreature: (perm) => isCurrentlyCreature(perm, battlefield, pid),
    excludePermanentId: gate.otherOnly ? String(permanent?.id || '') : null,
  });

  return getControlledCreatureCombatGateViolation({
    oracleText,
    controlledCreatureCount: controlledCount,
    action,
    permanentName: String(permanent?.card?.name || 'This creature'),
  });
}

function continuousGrantState(battlefield: any[] = [], gameState?: unknown): unknown {
  if (gameState && typeof gameState === 'object') {
    const record = gameState as { battlefield?: unknown };
    if (Array.isArray(record.battlefield)) return gameState;
    return { ...(gameState as object), battlefield };
  }
  return { battlefield };
}

export function canPermanentAttack(
  permanent: any,
  battlefield: any[] = [],
  controllerId?: string,
  gameState?: unknown,
): { canAttack: boolean; reason?: string } {
  const creatureGate = getControlledCreatureGateViolationForPermanent(
    permanent,
    battlefield,
    controllerId,
    'attack',
  );
  if (creatureGate.illegal) {
    return { canAttack: false, reason: creatureGate.reason || 'Creature-count combat gate' };
  }

  // Check for counters that prevent attacking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = isCounterPreventingAttack(permanent, battlefield);
  if (counterCheck.isPrevented) {
    return { 
      canAttack: false, 
      reason: `Has ${counterCheck.counterType} counter (${counterCheck.sourceName} effect)` 
    };
  }
  
  const continuousAbilities = getContinuousGrantedAbilitiesForPermanent(
    permanent,
    continuousGrantState(battlefield, gameState),
  );
  if (continuousAbilities.some((ability) => ability === "can't attack")) {
    return { canAttack: false, reason: "This creature cannot attack" };
  }

  const restrictionTexts = getTemporaryCombatAbilityTexts(permanent);
  if (restrictionTexts.some((entry) => entry === "can't attack" || entry.includes("can't attack this turn"))) {
    return { canAttack: false, reason: "This creature cannot attack" };
  }

  // Check for defender
  const defenderCheck = hasEffectiveAbility(permanent, 'defender', battlefield, controllerId);
  
  if (defenderCheck.hasAbility) {
    // Check if there's an "as though it didn't have defender" effect
    // Batch 15: self-only and conditional permissions are scoped (combatDefenderAttackPermission).
    const canAttackDespiteDefender = canAttackDespiteDefenderFn(permanent, battlefield, controllerId, gameState);
    if (!canAttackDespiteDefender) {
      return { canAttack: false, reason: 'Has defender' };
    }
  }
  
  return { canAttack: true };
}

/**
 * Check if a blocker can block a specific attacker considering evasion and "as though" effects
 * 
 * @param blocker - The potential blocking permanent
 * @param attacker - The attacking permanent
 * @param battlefield - All permanents on the battlefield
 * @returns Object with canBlock flag and reason if blocked
 */
export function canBlockAttacker(
  blocker: any,
  attacker: any,
  battlefield: any[] = [],
  blockerControllerId?: string,
  gameState?: unknown,
): { canBlock: boolean; reason?: string } {
  const creatureGate = getControlledCreatureGateViolationForPermanent(
    blocker,
    battlefield,
    blockerControllerId,
    'block',
  );
  if (creatureGate.illegal) {
    return { canBlock: false, reason: creatureGate.reason || 'Creature-count combat gate' };
  }
  const cowardReason = cowardsCantBlockWarriorsReason(blocker, attacker, battlefield);
  if (cowardReason) return { canBlock: false, reason: cowardReason };

  // Check for counters that prevent blocking (e.g., bribery counters with Gwafa Hazid)
  // Uses scalable pattern matching instead of hardcoded card checks
  const counterCheck = isCounterPreventingBlock(blocker, battlefield);
  if (counterCheck.isPrevented) {
    return { 
      canBlock: false, 
      reason: `Has ${counterCheck.counterType} counter (${counterCheck.sourceName} effect)` 
    };
  }

  if ((blocker as any).unleashed === true && Number(((blocker as any).counters || {})['+1/+1'] || 0) > 0) {
    return {
      canBlock: false,
      reason: 'Unleashed creature has a +1/+1 counter',
    };
  }

  const continuousBlockAbilities = getContinuousGrantedAbilitiesForPermanent(
    blocker,
    continuousGrantState(battlefield, gameState),
  );
  if (continuousBlockAbilities.some((ability) => ability === "can't block")) {
    return {
      canBlock: false,
      reason: "Blocker can't block",
    };
  }

  if (gameState && blockerCantBlockCreaturesYouControl(gameState as any, blocker, String(attacker?.controller || ''))) {
    return {
      canBlock: false,
      reason: "Can't block creatures that player controls",
    };
  }

  const blockerRestrictionTexts = getTemporaryCombatAbilityTexts(blocker);
  if (blockerRestrictionTexts.some((entry) => entry === "can't block" || entry.includes("can't block this turn"))) {
    return {
      canBlock: false,
      reason: "Blocker can't block this turn",
    };
  }

  const attackerRestrictionTexts = getTemporaryCombatAbilityTexts(attacker);
  if (attackerRestrictionTexts.some(isFullyUnblockableRestriction)) {
    return {
      canBlock: false,
      reason: 'Attacker cannot be blocked this turn',
    };
  }

  const conditionalUnblockable = conditionalUnblockableReason(attacker, gameState, battlefield); // B28/B29
  if (conditionalUnblockable) return { canBlock: false, reason: conditionalUnblockable };
  const attachedBlockReason = attachedBlockOnlyFlyingReason(blocker, attacker, battlefield); // B30
  if (attachedBlockReason) return { canBlock: false, reason: attachedBlockReason };
  const b31ExceptReason = artifactOrColorBlockOnlyReason(blocker, attacker); // B31
  if (b31ExceptReason) return { canBlock: false, reason: b31ExceptReason };
  const b33BlockCount = moreCreaturesBlockRestrictionReason(blocker, attacker, battlefield); // B33
  if (b33BlockCount) return { canBlock: false, reason: b33BlockCount };

  const landwalkReason = getLandwalkUnblockableReason(attacker, blockerControllerId, battlefield);
  if (landwalkReason) {
    return {
      canBlock: false,
      reason: landwalkReason,
    };
  }

  const colorBlockReason = getColorBlockRestrictionReason(attacker, blocker, attackerRestrictionTexts);
  if (colorBlockReason) {
    return { canBlock: false, reason: colorBlockReason };
  }

  const exceptColorBlockReason = getExceptColorBlockRestrictionReason(attacker, blocker, attackerRestrictionTexts, battlefield);
  if (exceptColorBlockReason) {
    return { canBlock: false, reason: exceptColorBlockReason };
  }

  const blockerPower = getEffectivePower(blocker, gameState);
  {
    const attackerContinuous = getContinuousGrantedAbilitiesForPermanent(attacker, continuousGrantState(battlefield, gameState));
    const qualifierReason = getQualifierBlockRestrictionReason(attacker, blocker, [...attackerRestrictionTexts, ...attackerContinuous], {
      blockerPower,
      blockerAbilities: continuousBlockAbilities,
      blockerToughness: getEffectiveToughness(blocker, gameState),
    });
    if (qualifierReason) return { canBlock: false, reason: qualifierReason };
  }
  if (attackerRestrictionTexts.some((entry) => entry.includes("can't be blocked by creatures with power 2 or less")) && blockerPower <= 2) {
    return {
      canBlock: false,
      reason: 'Attacker cannot be blocked by creatures with power 2 or less',
    };
  }

  const batch25BlockReason = getBatch25BlockRestrictionReason(attacker, blocker, battlefield, attackerRestrictionTexts,
    (perm, keyword) => hasEffectiveAbility(perm, keyword, battlefield, blockerControllerId).hasAbility);
  if (batch25BlockReason) return { canBlock: false, reason: batch25BlockReason };

  const attackerPower = getEffectivePower(attacker, gameState);
  if (attackerRestrictionTexts.some((entry) => entry.includes("can't be blocked by creatures with greater power")) && blockerPower > attackerPower) {
    return {
      canBlock: false,
      reason: 'Attacker cannot be blocked by creatures with greater power',
    };
  }
  
  // Check flying - can only be blocked by flying or reach
  const attackerFlying = hasEffectiveAbility(attacker, 'flying', battlefield, attacker.controller);
  if (attackerFlying.hasAbility) {
    const blockerFlying = hasEffectiveAbility(blocker, 'flying', battlefield, blockerControllerId);
    const blockerReach = hasEffectiveAbility(blocker, 'reach', battlefield, blockerControllerId);
    if (!blockerFlying.hasAbility && !blockerReach.hasAbility && !canBlockAsThoughReach(blocker, attacker)) {
      return { canBlock: false, reason: 'Attacker has flying' };
    }
  }
  
  // Check shadow - shadow can only be blocked by shadow
  const attackerShadow = hasEffectiveAbility(attacker, 'shadow', battlefield, attacker.controller);
  const blockerShadow = hasEffectiveAbility(blocker, 'shadow', battlefield, blockerControllerId);
  if (attackerShadow.hasAbility && !blockerShadow.hasAbility && !canBlockShadowAsThough(blocker, battlefield)) {
    return { canBlock: false, reason: 'Attacker has shadow' };
  }
  if (blockerShadow.hasAbility && !attackerShadow.hasAbility) {
    return { canBlock: false, reason: 'Blocker has shadow and can only block shadow' };
  }
  
  // Check horsemanship
  const attackerHorsemanship = hasEffectiveAbility(attacker, 'horsemanship', battlefield, attacker.controller);
  if (attackerHorsemanship.hasAbility) {
    const blockerHorsemanship = hasEffectiveAbility(blocker, 'horsemanship', battlefield, blockerControllerId);
    if (!blockerHorsemanship.hasAbility) {
      return { canBlock: false, reason: 'Attacker has horsemanship' };
    }
  }

  // Protection DEBT "B": creatures with the protected quality can't block.
  if (protectionPreventsSource(attacker, blocker, { battlefield })) {
    return { canBlock: false, reason: 'Attacker has protection from this blocker' };
  }
  
  return { canBlock: true };
}
