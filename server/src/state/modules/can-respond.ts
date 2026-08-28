/**
 * can-respond.ts
 * 
 * Determines if a player can respond to something during priority.
 * This enables auto-passing priority when a player has no legal responses available.
 * 
 * A player can respond if they can:
 * 1. Cast instant spells or spells with flash
 * 2. Activate abilities (tap abilities, activated abilities with costs)
 * 3. Pay the costs required (mana, tap, life, alternate costs like Force of Will)
 * 4. Have valid targets if targeting is required
 * 
 * This is used to improve gameplay flow by automatically passing priority
 * when a player has no available responses.
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";
import {
  isCounterPreventingAttack,
  isCounterPreventingBlock,
} from "../../../../shared/src/counterCombatRestrictions.js";
import { parseManaCost, normalizeParsedManaCost, canPayManaCostWithAvailableSources, getManaPoolFromState, getAvailableMana, getTotalManaFromPool } from "./mana-check";
import { hasPayableAlternateCost } from "./alternate-costs";
import { hasValidTargetsForSpell } from "../../rules-engine/target-availability.js";
import { hasExhaustedOnceDuringEachGraveyardCastActivation } from "../../../../rules-engine/src/stationPermanentUtils.js";
import { calculateMaxLandsPerTurn, canCastFromTop, canPlayLandsFromTop, getActiveAbilityConditions } from "./game-state-effects";
import { buildGraveyardCastingPermissionId, getActiveGraveyardCastingPermissions, getGrantedCastFromGraveyardKeywordInfo, getGrantedEmbalmInfo, getGrantedUnearthInfo, getPrintedSelfCastPermissionInfo, getPrintedUnearthInfo, isActivatableStationGraveyardPermissionLine, type GraveyardCastingPermission, type GraveyardCastingPermissionCostMode } from "./graveyard-permissions";
import { checkOpponentHasMoreLands } from './stackLandCountUtils.js';
import { detectActivatedAbilityConditionRequirement } from "./activated-ability-conditions";
import { isActivatedAbilityTimingLegal } from "./activation-timing.js";
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan, getCostAdjustmentForCard as getSharedCostAdjustmentForCard, type CostAdjustmentPlan } from "./cost-adjustments";
import { collectStaticEffectSources } from "./static-effect-sources";
import { getEffectiveAdditionalCost, permanentHasSummoningSickness } from "../../socket/game-actions.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { cardManaValue, parseWordNumber } from "../utils";
import { findPermanentsWithCreatureType } from "../../../../shared/src/creatureTypes.js";
import { getCurrentGoaders } from "./goad-effects.js";
import { isAbilityActivationProhibitedByChosenName, isSpellCastingProhibitedByChosenName } from "./chosen-name-restrictions.js";
import { canActivateLoyaltyAtInstantSpeed } from "./triggered-abilities.js";
import { canPayCounterRemovalCost } from "./counter-removal-costs.js";
import { cardAllowsPlayerToPlayFromExile, cardMeetsPlayFromExileConditions, getPlayableExileCardsForPlayer, getPlayableFromExileDurablePermissionForCard, isCardOnAdventureForPlayer } from "./playable-from-exile.js";
import { getDurableCommandZonePermissionForCard, playerHasDurableLandPlayPermission } from "./durable-permissions";
import { cardMayBeCastWithMayhem, parseMayhemCost } from './keywordCastMechanics.js';
import { buildFreeCastIntentFields } from './castIntent.js';
import { hydrateCardOracleInPlace } from './cardOracleHydration.js';
import { getOrComputeCachedBoolean } from "./can-respond-handlers/canRespondPriorityCache.js";
import type {
  SharedSpellSourceZone,
  SharedSpellCandidateMode,
  SharedSpellCandidatePayability,
  SharedSpellCastMethod,
  SharedLandSourceZone,
  SharedSourceGrantedAdditionalCost,
  SharedSpellCastCandidate,
  SharedPlayableLandCandidate,
  SharedCommanderParsedCost,
  SharedCommanderBaseCandidate,
  SharedCommanderAvailabilityCandidate,
  SharedCommanderCastCandidate,
} from "./can-respond-handlers/canRespondTypes.js";
export type {
  SharedSpellSourceZone,
  SharedSpellCandidateMode,
  SharedSpellCandidatePayability,
  SharedSpellCastMethod,
  SharedLandSourceZone,
  SharedSourceGrantedAdditionalCost,
  SharedSpellCastCandidate,
  SharedPlayableLandCandidate,
  SharedCommanderParsedCost,
  SharedCommanderBaseCandidate,
  SharedCommanderAvailabilityCandidate,
  SharedCommanderCastCandidate,
};
import { isTransformBackFace } from "./can-respond-handlers/canRespondTransformBackFace.js";
export { isTransformBackFace };
import { isSplitSecondLockActive, isLandTypeLine } from "./can-respond-handlers/canRespondSplitSecondLandPredicates.js";
import {
  getTopLibraryCard,
  getTopLibrarySpellPermission,
  canPlayTopLibraryLand,
  hasFlashOrInstant,
  hasFlashback,
  hasForetellOrCanCastFromExile,
  isCardPlayableFromExile,
} from "./can-respond-handlers/canRespondTopLibraryFlashExile.js";
export { hasFlashOrInstant, hasFlashback, hasForetellOrCanCastFromExile, isCardPlayableFromExile };
import { parseWordNumberForGraveyardCost } from "./can-respond-handlers/canRespondParseWordNumber.js";
import { isPermanentSpellType, isSorcerySpeedSpellCard } from "./can-respond-handlers/canRespondSpellTypePredicates.js";
import {
  normalizeRuleText,
  buildSyntheticGraveyardPermissionMetadata,
  findMatchingFirstClassGraveyardPermission,
  firstClassPermissionLeaveBattlefieldDestination,
  firstClassPermissionLeaveBattlefieldLifeGain,
  getGraveyardPermissionCostModeFromText,
  hasMarkedGraveyardPermission,
  isPlayersTurnForPermission,
  getGraveyardPermissionTextSources,
  isStaticGraveyardPermissionLine,
  spellQualifierMatchesCard,
  firstClassPermissionExilesSpell,
  getGraveyardPermanentTypesCastThisTurn,
  landQualifierMatchesCard,
} from "./can-respond-handlers/canRespondGraveyardPermissionMatching.js";
import {
  canPaySourceGrantedAdditionalCost,
  getSpecificSpellFromGraveyardPermission,
  getSourceGrantedAdditionalCost,
} from "./can-respond-handlers/canRespondGraveyardSpellPermission.js";
import { getSpecificLandFromGraveyardPermission } from "./can-respond-handlers/canRespondGraveyardLandPermission.js";
import { getHandCastEvaluationCards, normalizeParsedCostForAnyTypeManaSpending } from "./can-respond-handlers/canRespondHandCastEvaluation.js";
export { getHandCastEvaluationCards };
import { getCastableSpellCandidates } from "./can-respond-handlers/canRespondCastableSpellCandidates.js";
export { getCastableSpellCandidates };
import { isInMainPhase } from "./can-respond-handlers/canRespondMainPhase.js";
import { canCastAnySpell } from "./can-respond-handlers/canRespondCanCastAnySpell.js";
export { canCastAnySpell };
import { isActivatedAbilityConditionMet } from "./can-respond-handlers/canRespondActivatedAbilityCondition.js";
import {
  canActivateAnyAbility,
  hasSacrificePrefixActivatedAbility,
  hasActivatableLoyaltyAbility,
} from "./can-respond-handlers/canRespondActivatableAbilities.js";
export { canActivateAnyAbility, hasSacrificePrefixActivatedAbility };
import { getCommandZoneCommanderCandidates, getCastableCommanderCandidates } from "./can-respond-handlers/canRespondCommandZoneCandidates.js";
export { getCommandZoneCommanderCandidates, getCastableCommanderCandidates };
import {
  getPlayableLandCandidates,
  canPlayLand,
  isCardPlayableAsLandFromHand,
  getPlayableLandFaceIndex,
  getHandCastEvaluationCard,
} from "./can-respond-handlers/canRespondPlayableLands.js";
export { getPlayableLandCandidates, canPlayLand, isCardPlayableAsLandFromHand, getPlayableLandFaceIndex, getHandCastEvaluationCard };























/**
 * Check if a spell has valid targets available on the battlefield.
 * This prevents spells requiring targets from being considered "playable" when no valid targets exist.
 * 
 * MTG Rule 601.2c: A spell or ability cannot be cast/activated unless valid targets are available
 * for all required targets.
 * 
 * @param state - Game state
 * @param playerId - The player casting the spell
 * @param card - The card being checked
 * @returns true if spell has valid targets (or doesn't require targets), false otherwise
 */
// Target checks are centralized in server/rules-engine/target-availability.ts

/**
export function getCostAdjustmentForCard(state: any, playerId: PlayerID, card: any): number {
  return getSharedCostAdjustmentForCard(state, playerId, card);
}

/**
 * Detailed cost adjustment info for UI display
 */
export interface CostAdjustmentInfo {
  originalCost: string;
  adjustedCost: string;
  adjustment: number;       // positive = increase, negative = reduction
  genericAdjustment: number;
  sources: Array<{ name: string; amount: number }>;
}

/**
 * Get detailed cost adjustment info for a card including source names
 * This is used for UI display to show what's affecting the cost
 */
export function getCostAdjustmentInfo(state: any, playerId: string, card: any): CostAdjustmentInfo | null {
  if (!card) return null;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const manaCostRaw = card.mana_cost || "";
  
  // Skip lands - they don't have mana costs
  if (typeLine.includes("land")) return null;
  const adjustmentPlan = buildCostAdjustmentPlan(state, playerId, card);
  
  // Only return info if there's an adjustment
  if (adjustmentPlan.sources.length === 0) return null;
  
  // Calculate adjusted mana cost string
  const parsed = parseManaCost(manaCostRaw);
  const adjusted = applyCostAdjustmentToParsedCost(parsed, adjustmentPlan);
  
  // Reconstruct adjusted cost string
  let adjustedCostParts: string[] = [];
  // Only add generic mana component if:
  // 1. The original cost had generic mana (parsed.generic > 0), OR
  // 2. There's an adjustment that would add generic mana (adjusted > 0)
  if (adjusted.generic > 0 || parsed.generic > 0) {
    adjustedCostParts.push(`{${adjusted.generic}}`);
  }
  // Add color requirements
  for (const [color, count] of Object.entries(adjusted.colors)) {
    for (let i = 0; i < (count as number); i++) {
      adjustedCostParts.push(`{${color}}`);
    }
  }
  if (parsed.hasX) {
    adjustedCostParts.unshift('{X}');
  }
  const adjustedCost = adjustedCostParts.join('');
  
  return {
    originalCost: manaCostRaw,
    adjustedCost: adjustedCost || manaCostRaw,
    adjustment: adjustmentPlan.totalAdjustment,
    genericAdjustment: adjustmentPlan.genericAdjustment,
    sources: adjustmentPlan.sources,
  };
}









/**
 * Determine if a player can respond to something on the stack or during priority.
 * 
 * A player can respond if they can cast an instant/flash spell or activate an ability
 * that uses the stack. This is used for auto-passing non-active players.
 * 
 * NOTE: This function is intentionally STRICT - it only returns true if the player
 * has instant-speed responses available. For the active player during their own turn,
 * use canAct() instead, which is more conservative.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player can respond, false otherwise
 */
export function canRespond(ctx: GameContext, playerId: PlayerID): boolean {
  return getOrComputeCachedBoolean(ctx, playerId, 'canRespond', () => canRespondUncached(ctx, playerId));
}

function canRespondUncached(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    debug(2, `[canRespond] ${playerId}: checking instant-speed responses only`);

    const currentStep = String((ctx.state as any).step || '').toUpperCase();
    if (currentStep === 'UNTAP') {
      debug(2, `[canRespond] ${playerId}: no player receives priority during untap (returning false)`);
      return false;
    }

    // Split Second: no spells/stack abilities can be responded with.
    if (isSplitSecondLockActive(ctx.state)) {
      debug(2, `[canRespond] ${playerId}: Split Second lock active (returning false)`);
      return false;
    }
    
    // Check if player can cast any instant/flash spells
    if (canCastAnySpell(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can cast instant/flash spell`);
      return true;
    }
    
    // Check if player can activate any abilities
    if (canActivateAnyAbility(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can activate ability`);
      return true;
    }

    if (canCastCommanderFromCommandZone(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can cast commander from command zone`);
      return true;
    }
    
    // No instant-speed responses available
    debug(2, `[canRespond] ${playerId}: No instant-speed responses available (returning false)`);
    return false;
  } catch (err) {
    debugWarn(1, "[canRespond] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast their commander(s) from the command zone
 * Commanders can be cast at any time they could normally cast that type of spell
 * (e.g., instant if it has flash, sorcery-speed otherwise)
 * 
 * @param ctx Game context
 * @param playerId Player to check
 * @returns true if player can afford to cast at least one commander
 */
function canCastCommanderFromCommandZone(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;

    const currentStep = String((state as any).step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;

    for (const candidate of getCastableCommanderCandidates(ctx, playerId)) {
      if (candidate.grantsFlash) {
        debug(2, `[canCastCommanderFromCommandZone] ${playerId}: Commander ${candidate.card?.name} has flash/instant - can cast`);
        return true;
      }

      if (isMainPhase && stackIsEmpty) {
        debug(2, `[canCastCommanderFromCommandZone] ${playerId}: Commander ${candidate.card?.name} can be cast (main phase, empty stack)`);
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canCastCommanderFromCommandZone] Error:", err);
    return false;
  }
}

/**
 * Determine if the active player can take any action during their turn.
 * 
 * This is a MORE CONSERVATIVE check than canRespond - it returns true if the player
 * can take ANY action, including:
 * - Instant/flash spells (checked by canRespond)
 * - Activated abilities (checked by canRespond)
 * - Casting commanders from command zone
 * - Playing lands (if lands played < maxLands AND in main phase with empty stack)
 * - Sorcery-speed spells (if in main phase with empty stack)
 * 
 * This function should be used for the active player (turn player) to decide if they
 * should be auto-passed. The active player should almost NEVER be auto-passed during
 * their main phase if they have any possible actions.
 * 
 * @param ctx Game context
 * @param playerId The player to check (should be the active player)
 * @returns true if the player can take any action, false otherwise
 */

/**
 * Check if a creature is goaded (Rule 701.15)
 * Goaded creatures must attack each combat if able.
 */
function isCreatureGoaded(permanent: any, battlefield: any[], currentTurn?: number): boolean {
  return getCurrentGoaders(permanent, battlefield, currentTurn).length > 0;
}

/**
 * Check if player has any goaded creatures that MUST attack (Rule 701.15b)
 * This is different from hasValidAttackers - goaded creatures MUST attack if able,
 * so the player cannot skip combat declaration when they have goaded creatures.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player has any goaded creatures that can attack
 */
export function turnPlayerMustDeclareAttackers(ctx: GameContext, playerId: PlayerID): boolean {
  return hasValidAttackers(ctx, playerId) || hasGoadedCreaturesThatMustAttack(ctx, playerId);
}

function hasGoadedCreaturesThatMustAttack(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    const currentTurn = (state as any).turn;
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Check if this creature is goaded
      if (!isCreatureGoaded(permanent, battlefield, currentTurn)) continue;
      
      // Can't attack if tapped
      if (permanent.tapped) continue;
      
      // Rule 701.15b: must attack *if able*. Summoning sickness without haste is not able.
      if (permanentHasSummoningSickness(permanent, battlefield, playerId)) continue;
      
      // Check for "can't attack" effects
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
        continue;
      }
      
      const hasCantAttack = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
      });
      
      if (hasCantAttack) continue;
      
      // Found a goaded creature that CAN attack, so it MUST attack
      debug(2, `[hasGoadedCreaturesThatMustAttack] ${playerId}: Found goaded creature that must attack: ${permanent.card?.name || permanent.id}`);
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasGoadedCreaturesThatMustAttack] Error:", err);
    return true; // On error, assume they might have goaded creatures (don't auto-pass)
  }
}

/**
 * Check if player has any valid attackers (untapped creatures that can attack)
 * Used to prevent auto-pass from skipping attack phase when creatures are available
 */
export function hasValidAttackers(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Can't attack if tapped
      if (permanent.tapped) continue;
      
      if (permanentHasSummoningSickness(permanent, battlefield, playerId)) continue;
      
      // Check for "can't attack" effects (like Pacifism, Trapped in the Tower, etc.)
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      // Check permanent's own text
      if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
        continue; // This creature can't attack
      }
      
      // Check granted abilities from other sources
      const hasCantAttack = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
      });
      
      if (hasCantAttack) continue; // Granted ability prevents attacking

      const briberyAttackCheck = isCounterPreventingAttack(permanent, battlefield);
      if (briberyAttackCheck.isPrevented) continue;
      
      // If we have an untapped creature without summoning sickness that can attack, return true
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasValidAttackers] Error:", err);
    return true; // On error, assume they might have attackers (don't auto-pass)
  }
}

/**
 * Check if player has any valid blockers (untapped creatures that can block)
 * Used to prevent auto-pass from skipping block phase when creatures are available
 */
function hasValidBlockers(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    
    // First check if there are any declared attackers to block
    const declaredAttackers = (state as any).declaredAttackers || [];
    if (declaredAttackers.length === 0) {
      return false; // No attackers to block
    }
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Can't block if tapped
      if (permanent.tapped) continue;

      const unleashPreventsBlocking =
        (permanent as any).unleashed === true &&
        Number((permanent.counters || {})['+1/+1'] || 0) > 0;
      if (unleashPreventsBlocking) continue;
      
      // Check for "can't block" effects (like Goblin Tunneler's ability)
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      // Check permanent's own text
      if (oracleText.includes("can't block") || oracleText.includes("cannot block")) {
        continue; // This creature can't block
      }
      
      // Check granted abilities from other sources
      const hasCantBlock = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't block") || abilityText.includes("cannot block");
      });
      
      if (hasCantBlock) continue; // Granted ability prevents blocking

      const counterBlockCheck = isCounterPreventingBlock(permanent, battlefield);
      if (counterBlockCheck.isPrevented) continue;
      
      // Note: Flying/reach restrictions are complex and would require checking all attackers
      // For Smart Auto-Pass purposes, we're conservative: if any untapped creature exists, 
      // pause to let player decide (they might have flying blockers for flying attackers, etc.)
      // This is safer than auto-passing and missing a valid block
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasValidBlockers] Error:", err);
    return true; // On error, assume they might have blockers (don't auto-pass)
  }
}

/**
 * True when the player has no legal priority actions (sorcery-speed or instant-speed).
 * Idle players are auto-passed even when the optional auto-pass preference is off.
 */
export function isPlayerIdleForAutoPass(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const turnPlayer = (ctx.state as any).turnPlayer;
    const isActivePlayer = turnPlayer === playerId;
    const canTakeAct = isActivePlayer ? canAct(ctx, playerId) : false;
    const canTakeRespond = canRespond(ctx, playerId);
    return !canTakeAct && !canTakeRespond;
  } catch (err) {
    debugWarn(1, '[isPlayerIdleForAutoPass] Error:', err);
    return false;
  }
}

export function canAct(ctx: GameContext, playerId: PlayerID): boolean {
  return getOrComputeCachedBoolean(ctx, playerId, 'canAct', () => canActUncached(ctx, playerId));
}

function canActUncached(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const currentStep = String((ctx.state as any).step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !ctx.state.stack || ctx.state.stack.length === 0;
    const isTurnPlayer = (ctx.state as any).turnPlayer === playerId;

    if (currentStep === 'UNTAP') {
      debug(2, `[canAct] ${playerId}: no player receives priority during untap (returning false)`);
      return false;
    }
    
    debug(2, `[canAct] ${playerId}: step=${currentStep}, isMainPhase=${isMainPhase}, stackIsEmpty=${stackIsEmpty}, isTurnPlayer=${isTurnPlayer}`);
    
    // CRITICAL: During main phase with empty stack, the turn player should ALWAYS be allowed
    // to take sorcery-speed actions (play land, cast creatures, etc.) before auto-passing.
    // This prevents the race condition where auto-pass advances the step before the player
    // has a chance to play their land or cast sorcery-speed spells.
    //
    // Per MTG rules: During a main phase, if the stack is empty, the active player receives
    // priority and may play lands, cast spells, or activate abilities before passing.
    if (isMainPhase && stackIsEmpty && isTurnPlayer) {
      // Check if player can play a land FIRST (highest priority action)
      // This ensures we never skip the land play opportunity
      if (canPlayLand(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Turn player in main phase can play land - returning TRUE`);
        return true;
      }
    }
    
    // First check instant-speed responses (same as canRespond)
    if (canCastAnySpell(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can cast instant/flash spell - returning TRUE`);
      return true;
    }
    
    if (canActivateAnyAbility(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can activate ability - returning TRUE`);
      return true;
    }
    
    // Check if player can cast commander from command zone (any time they could cast it)
    if (canCastCommanderFromCommandZone(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can cast commander from command zone - returning TRUE`);
      return true;
    }
    
    // During main phase with empty stack, check sorcery-speed actions
    if (isMainPhase && stackIsEmpty) {
      debug(2, `[canAct] ${playerId}: In main phase with empty stack, checking sorcery-speed actions`);
      
      // Check if player can play a land (Note: This is also checked above for turn player specifically,
      // but we check here too for completeness in case of unusual game states)
      if (canPlayLand(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can play land - returning TRUE`);
        return true;
      }
      
      // Check if player can cast any sorcery-speed spells
      if (canCastAnySorcerySpeed(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can cast sorcery-speed spell - returning TRUE`);
        return true;
      }
      
      // Check if player can activate sorcery-speed abilities (equip, reconfigure, etc.)
      if (canActivateSorcerySpeedAbility(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can activate sorcery-speed ability - returning TRUE`);
        return true;
      }
      
      // Active player with untapped mana sources must keep main-phase priority.
      // Idle auto-pass + opponent "pass empty stack" previously rocket-advanced
      // MAIN→CLEANUP while Sol Ring / lands were still untapped — mana abilities
      // alone do not count as canActivate. Floating-only mana still requires an
      // affordable action (otherwise empty-hand leftover mana would block forever).
      if (isTurnPlayer) {
        const floatingMana = getTotalManaFromPool(getManaPoolFromState(ctx.state as any, playerId));
        const availableMana = getTotalManaFromPool(getAvailableMana(ctx.state as any, playerId));
        if (availableMana > floatingMana) {
          debug(2, `[canAct] ${playerId}: Untapped mana sources in main phase (available=${availableMana}, floating=${floatingMana}) - returning TRUE`);
          return true;
        }
        if (floatingMana > 0) {
          const relaxedCandidates = getCastableSpellCandidates(ctx, playerId, {
            mode: 'sorcery',
            skipIgnoredCards: false,
            allowAlternateCosts: true,
            allowUnknownCostFallback: true,
            conservativeTargets: false,
          });
          if (relaxedCandidates.length > 0 || canActivateAnyAbility(ctx, playerId)) {
            debug(2, `[canAct] ${playerId}: Floating mana with affordable main-phase action - returning TRUE`);
            return true;
          }
        }
      }

      debug(2, `[canAct] ${playerId}: No sorcery-speed actions available in main phase - returning FALSE`);
      return false;
    } else {
      debug(1, `[canAct] ${playerId}: Not in main phase with empty stack (phase check failed or stack not empty) - returning FALSE`);
    }
    
    // Check combat phases - if player has valid attackers/blockers, they can act
    // This prevents auto-pass from skipping combat declaration when creatures are available
    
    // GOAD ENFORCEMENT (Rule 701.15b): Goaded creatures MUST attack if able
    // This check ensures that:
    // 1. Players cannot skip combat if they have goaded creatures
    // 2. Auto-pass and smart-pass do not bypass combat with goaded creatures
    // 3. Phase navigator cannot skip to end step if goaded creatures exist
    
    // Check during beginning of combat - if player has goaded creatures, they must proceed to declare attackers
    if ((currentStep === 'BEGIN_COMBAT' || currentStep === 'BEGINNING_OF_COMBAT') && isTurnPlayer && stackIsEmpty) {
      if (hasGoadedCreaturesThatMustAttack(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has goaded creatures that must attack - cannot skip combat - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_ATTACKERS' && isTurnPlayer && stackIsEmpty) {
      // FIRST: Check if player has goaded creatures that MUST attack (Rule 701.15b)
      // Goaded creatures must attack if able - player cannot skip this
      if (hasGoadedCreaturesThatMustAttack(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has goaded creatures that MUST attack - returning TRUE`);
        return true;
      }
      
      // Check if player has any creatures that can attack
      if (hasValidAttackers(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has valid attackers - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_BLOCKERS' && !isTurnPlayer && stackIsEmpty) {
      // Check if player has any creatures that can block
      if (hasValidBlockers(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has valid blockers - returning TRUE`);
        return true;
      }
    }
    
    // No actions available
    debug(2, `[canAct] ${playerId}: No actions available - returning FALSE`);
    return false;
  } catch (err) {
    debugWarn(1, "[canAct] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast any sorcery-speed spell from hand, graveyard (flashback),
 * or exile (foretell/impulse draw)
 * (creatures, sorceries, artifacts, enchantments, planeswalkers)
 */
function canCastAnySorcerySpeed(ctx: GameContext, playerId: PlayerID): boolean {
  return getCastableSpellCandidates(ctx, playerId, {
    mode: 'sorcery',
    skipIgnoredCards: true,
    allowAlternateCosts: true,
    allowUnknownCostFallback: true,
    conservativeTargets: false,
  }).length > 0;
}

/**
 * Check if player can activate any sorcery-speed abilities (equip, reconfigure, etc.)
 * These can only be activated during main phase when stack is empty
 */
function canActivateSorcerySpeedAbility(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    const pool = getAvailableMana(state, playerId);
    
    // Check each permanent controlled by the player
    for (const permanent of battlefield) {
      if (!permanent || !permanent.card) continue;
      if (permanent.controller !== playerId) continue;
      
      const oracleText = permanent.card.oracle_text || "";
      const effectLower = oracleText.toLowerCase();
      
      // Check for equip ability: "Equip {cost}" or "{cost}: Equip"
      if (effectLower.includes("equip")) {
        // Try pattern 1: "Equip {cost}"
        let equipMatch = oracleText.match(/equip\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        
        // Try pattern 2: "{cost}: Equip"
        if (!equipMatch) {
          equipMatch = oracleText.match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*:\s*equip/i);
        }
        
        if (equipMatch) {
          const costString = equipMatch[1];
          if (costString) {
            const parsedCost = parseManaCost(costString);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              // Also check if there's a valid target (a creature to equip)
              const hasCreatureTarget = battlefield.some((p: any) => 
                p.controller === playerId && 
                (p.card?.type_line || "").toLowerCase().includes("creature")
              );
              if (hasCreatureTarget) {
                return true;
              }
            }
          }
        }
      }
      
      // Check for reconfigure ability: "Reconfigure {cost}"
      if (effectLower.includes("reconfigure")) {
        const reconfigureMatch = oracleText.match(/reconfigure\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        if (reconfigureMatch) {
          const costString = reconfigureMatch[1];
          const parsedCost = parseManaCost(costString);
          if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
            return true;
          }
        }
      }
      
      // Check for other sorcery-speed only abilities
      // First check if this ability has sorcery-speed restriction
      if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
        // Look for any activated ability pattern before the restriction: "{cost}: Effect"
        const abilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*([^.]+)/gi;
        const matches = oracleText.matchAll(abilityPattern);
        
        for (const match of matches) {
          const costString = match[1];
          const fullAbilityText = `${String(costString || '').trim()}: ${String(match[2] || '').trim()}`;
          if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, match.index)) {
            continue;
          }
          if (costString) {
            const parsedCost = parseManaCost(costString);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              return true;
            }
          }
        }
      }
      
      // Check for planeswalker loyalty abilities (sorcery-speed by default).
      if (hasActivatableLoyaltyAbility(state, battlefield, playerId, permanent)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canActivateSorcerySpeedAbility] Error:", err);
    return false;
  }
}

