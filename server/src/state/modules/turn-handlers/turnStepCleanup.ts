// server/src/state/modules/turn-handlers/turnStepCleanup.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the cleanup-step body from nextStep() plus the private
// helpers that body uniquely closes over - discard-to-hand-size, Sundial
// pause, Rule 514.2 damage clear, until-end-of-turn effect expiry, and
// lastingEffects.protectionKeywordOverride / preventLifeGain this-turn expiry.
// Public entry symbols: runTurnStepCleanup.
// Called from nextStep() in the parent; not part of the public turn.ts API.
// nextTurn stays in the parent dispatcher (leaf must not import turn.ts).

import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { clearTemporaryEtbTriggers } from '../triggerEtbEntryEffects.js';
import { clearMarkedPermanentDamage } from "../counter-common-effects.js";
import { syncPreparedPermanentAfterControlChange } from "../prepared.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { clearTemporaryGraveyardKeywordGrants, clearTemporaryPlayableFromGraveyardPermissions } from "../graveyard-permissions.js";
import { expireDelayedDealtDamageWatchers } from "../triggers/dealt-damage-watchers.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function getCurrentTurnNumberForEffects(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0);
  return Number.isFinite(currentTurn) ? currentTurn : 0;
}

/**
 * Clear damage from all permanents on the battlefield.
 * Rule 514.2 / 703.4p: During the cleanup step, all damage marked on permanents
 * is removed simultaneously. This happens after discarding to hand size and
 * before "until end of turn" effects end.
 */
function clearDamageFromPermanents(ctx: GameContext) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let clearedCount = 0;

    for (const permanent of battlefield) {
      if (!permanent) continue;

      const hadDamage =
        Number(permanent.damageMarked || 0) > 0 ||
        Number(permanent.markedDamage || 0) > 0 ||
        Number(permanent.damage || 0) > 0 ||
        Boolean(permanent.deathtouchDamageMarked) ||
        (permanent.counters && typeof permanent.counters.damage === 'number' && permanent.counters.damage > 0);

      if (!hadDamage) continue;

      clearMarkedPermanentDamage(permanent);
      clearedCount++;
    }

    if (clearedCount > 0) {
      debug(2, `${ts()} [clearDamageFromPermanents] Cleared damage from ${clearedCount} permanent(s) (Rule 514.2/703.4p)`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} clearDamageFromPermanents failed:`, err);
  }
}

/**
 * End all "until end of turn" and "this turn" effects.
 * Rule 514.2: These effects end simultaneously with damage removal during cleanup.
 */
function endTemporaryEffects(ctx: GameContext) {
  try {
    const state = (ctx as any).state;
    if (!state) return;
    
    let endedCount = 0;
    
    // Clear temporary effects stored on battlefield permanents
    const battlefield = state.battlefield || [];
    for (const permanent of battlefield) {
      if (!permanent) continue;
      
      // Clear "until end of turn" modifiers (remove tracked granted abilities first)
      if (permanent.untilEndOfTurn) {
        const toRemove = Array.isArray(permanent.untilEndOfTurn.grantedAbilitiesToRemove)
          ? permanent.untilEndOfTurn.grantedAbilitiesToRemove
          : [];
        if (toRemove.length > 0 && Array.isArray(permanent.grantedAbilities)) {
          const removeSet = new Set(toRemove.map((ability: any) => String(ability || '').toLowerCase()));
          permanent.grantedAbilities = permanent.grantedAbilities.filter(
            (ability: any) => !removeSet.has(String(ability || '').toLowerCase()),
          );
          if (permanent.grantedAbilities.length === 0) {
            delete permanent.grantedAbilities;
          }
        }
        delete permanent.untilEndOfTurn;
        endedCount++;
      }

      if (Array.isArray((permanent as any).temporaryEffects) && (permanent as any).temporaryEffects.length > 0) {
        const expiredKeywords = new Set<string>();
        const remainingEffects = (permanent as any).temporaryEffects.filter((effect: any) => {
          if (String(effect?.expiresAt || '') !== 'end_of_turn') {
            return true;
          }
          for (const granted of Array.isArray(effect?.grantedAbilities) ? effect.grantedAbilities : []) {
            const normalized = String(granted || '').trim().toLowerCase();
            if (normalized) expiredKeywords.add(normalized);
          }
          return false;
        });

        if (expiredKeywords.size > 0 && Array.isArray(permanent.grantedAbilities)) {
          permanent.grantedAbilities = permanent.grantedAbilities.filter(
            (ability: any) => !expiredKeywords.has(String(ability || '').toLowerCase()),
          );
          if (permanent.grantedAbilities.length === 0) {
            delete permanent.grantedAbilities;
          }
        }

        if (remainingEffects.length > 0) {
          (permanent as any).temporaryEffects = remainingEffects;
        } else {
          delete (permanent as any).temporaryEffects;
        }
        endedCount++;
      }
      
      // Clear temporary power/toughness modifications
      if (permanent.tempPowerMod !== undefined) {
        delete permanent.tempPowerMod;
        endedCount++;
      }
      if (permanent.tempToughnessMod !== undefined) {
        delete permanent.tempToughnessMod;
        endedCount++;
      }
      if (permanent.temporaryPowerBoost !== undefined) {
        delete permanent.temporaryPowerBoost;
        endedCount++;
      }
      if (permanent.temporaryToughnessBoost !== undefined) {
        delete permanent.temporaryToughnessBoost;
        endedCount++;
      }
      if (permanent.tempPowerBonus !== undefined) {
        delete permanent.tempPowerBonus;
        endedCount++;
      }
      if (permanent.tempToughnessBonus !== undefined) {
        delete permanent.tempToughnessBonus;
        endedCount++;
      }
      if (permanent.tempBonusExpires !== undefined) {
        delete permanent.tempBonusExpires;
        endedCount++;
      }
      delete permanent.tempCombatPowerBonus;
      delete permanent.tempCombatToughnessBonus;

      // Oracle IR P/T changes are canonical in `modifiers` and mirrored into
      // `temporaryPTMods` for server/client stat calculation. Expire both
      // representations together so old effects cannot survive cleanup or be
      // mirrored again by a later Oracle IR resolution.
      if (Array.isArray((permanent as any).temporaryPTMods)) {
        const before = (permanent as any).temporaryPTMods.length;
        (permanent as any).temporaryPTMods = (permanent as any).temporaryPTMods.filter((entry: any) => {
          const duration = String(entry?.until || entry?.expiresAt || '').trim().toLowerCase();
          return duration !== 'end_of_turn'
            && duration !== 'until_end_of_turn'
            && duration !== 'eot'
            && duration !== 'this_turn'
            && duration !== 'end_of_combat';
        });
        if ((permanent as any).temporaryPTMods.length === 0) {
          delete (permanent as any).temporaryPTMods;
        }
        endedCount += before - ((permanent as any).temporaryPTMods?.length || 0);
      }

      if (Array.isArray((permanent as any).modifiers)) {
        const before = (permanent as any).modifiers.length;
        (permanent as any).modifiers = (permanent as any).modifiers.filter((entry: any) => {
          const duration = String(entry?.duration || entry?.until || entry?.expiresAt || '').trim().toLowerCase();
          return duration !== 'end_of_turn'
            && duration !== 'until_end_of_turn'
            && duration !== 'eot'
            && duration !== 'this_turn'
            && duration !== 'end_of_combat';
        });
        if ((permanent as any).modifiers.length === 0) {
          delete (permanent as any).modifiers;
        }
        endedCount += before - ((permanent as any).modifiers?.length || 0);
      }

      delete permanent.effectivePower;
      delete permanent.effectiveToughness;
      
      // Clear temporary granted abilities
      if (permanent.tempAbilities && permanent.tempAbilities.length > 0) {
        permanent.tempAbilities = [];
        endedCount++;
      }

      if (Array.isArray((permanent as any).temporaryAbilities) && (permanent as any).temporaryAbilities.length > 0) {
        const remainingTemporaryAbilities = (permanent as any).temporaryAbilities.filter((entry: any) => {
          if (typeof entry === 'string') {
            return false;
          }
          return entry?.expiresAt && entry.expiresAt !== 'end_of_turn';
        });

        if (remainingTemporaryAbilities.length > 0) {
          (permanent as any).temporaryAbilities = remainingTemporaryAbilities;
        } else {
          delete (permanent as any).temporaryAbilities;
        }
        endedCount++;
      }
      
      // Clear "this turn" flags
      if (permanent.summoningSickness === false && permanent.enteredThisTurn) {
        // If it entered this turn, reset summoning sickness handling
        delete permanent.enteredThisTurn;
      }
      
      // Clear "attacked this turn" and similar combat flags
      if (permanent.attackedThisTurn) {
        delete permanent.attackedThisTurn;
      }
      if (permanent.blockedThisTurn) {
        delete permanent.blockedThisTurn;
      }
      if ((permanent as any).exertedThisTurn) {
        delete (permanent as any).exertedThisTurn;
      }
      
      // Clear Steel Hellkite combat damage tracking
      if (permanent.dealtCombatDamageTo) {
        delete permanent.dealtCombatDamageTo;
        endedCount++;
      }
      
      // Clear "activated this turn" flags for once-per-turn abilities
      if (permanent.activatedThisTurn) {
        delete permanent.activatedThisTurn;
        endedCount++;
      }

      if (permanent.activatedAbilityIndicesThisTurn) {
        delete permanent.activatedAbilityIndicesThisTurn;
        endedCount++;
      }
      
      // Clear crewed status from vehicles (they stop being creatures at end of turn)
      if (permanent.crewed) {
        delete permanent.crewed;
        // Remove granted Creature type from crew effect
        if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
          permanent.grantedTypes = permanent.grantedTypes.filter((t: string) => t !== 'Creature');
        }
        endedCount++;
      }
    }

    if (Array.isArray(state.staticAbilityGrantEffects) && state.staticAbilityGrantEffects.length > 0) {
      const before = state.staticAbilityGrantEffects.length;
      state.staticAbilityGrantEffects = state.staticAbilityGrantEffects.filter(
        (effect: any) => String(effect?.duration || '') !== 'end_of_turn',
      );
      if (state.staticAbilityGrantEffects.length === 0) {
        delete state.staticAbilityGrantEffects;
      }
      endedCount += before - (state.staticAbilityGrantEffects?.length || 0);
    }

    if (Array.isArray(state.lastingEffects) && state.lastingEffects.length > 0) {
      const before = state.lastingEffects.length;
      const expiringDurations = new Set(['end_of_turn', 'until_end_of_turn', 'this_turn', 'eot']);
      state.lastingEffects = state.lastingEffects.filter((effect: any) => {
        const type = String(effect?.type || '');
        const duration = String(effect?.duration || '').trim().toLowerCase();
        if (type === 'protectionKeywordOverride') {
          return !expiringDurations.has(duration);
        }
        if (type === 'preventLifeGain' || type === 'attackTaxGeneric' || type === 'attackTaxLife' || type === 'blockTaxGeneric' || type === 'freeHandCastsThisTurn') {
          // Missing duration is the original this-turn stamp (Skullcrack / War Tax).
          // Rest-of-game locks must set duration 'game'. until_your_next_turn lasts
          // until the source controller's next turn (not cleanup).
          if (!duration || expiringDurations.has(duration)) return false;
          return true;
        }
        return true;
      });
      if (state.lastingEffects.length === 0) {
        delete state.lastingEffects;
      }
      endedCount += before - (state.lastingEffects?.length || 0);
    }

    endedCount += clearTemporaryGraveyardKeywordGrants(state);
    endedCount += clearTemporaryPlayableFromGraveyardPermissions(state);
    endedCount += clearTemporaryEtbTriggers(state);

    // Revert temporary control changes recorded for cleanup.
    if (Array.isArray((state as any).controlChangeEffects) && (state as any).controlChangeEffects.length > 0) {
      const expiringDurations = new Set(['eot', 'turn', 'until_end_of_turn', 'this_turn']);
      const expiringEffects = ((state as any).controlChangeEffects as any[]).filter((effect: any) =>
        expiringDurations.has(String(effect?.duration || '').trim().toLowerCase())
      );
      const remainingEffects = ((state as any).controlChangeEffects as any[]).filter((effect: any) =>
        !expiringDurations.has(String(effect?.duration || '').trim().toLowerCase())
      );

      const firstExpiringByPermanent = new Map<string, any>();
      for (const effect of expiringEffects) {
        const permanentId = String(effect?.permanentId || '').trim();
        if (!permanentId || firstExpiringByPermanent.has(permanentId)) continue;
        firstExpiringByPermanent.set(permanentId, effect);
      }

      for (const [permanentId, effect] of firstExpiringByPermanent.entries()) {
        const permanent = battlefield.find((entry: any) => entry && String(entry.id || '').trim() === permanentId);
        if (!permanent) continue;

        const originalController = String(effect?.originalController || '').trim();
        const previousController = String(permanent.controller || '').trim();
        if (!originalController) continue;

        permanent.controller = originalController;
        syncPreparedPermanentAfterControlChange(state, permanent, previousController);

        const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
        if (typeLine.includes('creature')) {
          permanent.summoningSickness = true;
        }
        endedCount++;
      }

      if (remainingEffects.length > 0) {
        (state as any).controlChangeEffects = remainingEffects;
      } else {
        delete (state as any).controlChangeEffects;
      }
    }
    
    // Clear game-level temporary effects
    if (state.temporaryEffects && state.temporaryEffects.length > 0) {
      const beforeCount = state.temporaryEffects.length;
      state.temporaryEffects = state.temporaryEffects.filter((effect: any) => 
        effect.duration !== 'until_end_of_turn' && effect.duration !== 'this_turn'
      );
      endedCount += beforeCount - state.temporaryEffects.length;
    }

    if (Array.isArray(state.damagePreventionEffects) && state.damagePreventionEffects.length > 0) {
      const beforeCount = state.damagePreventionEffects.length;
      const currentTurn = getCurrentTurnNumberForEffects(state);
      state.damagePreventionEffects = state.damagePreventionEffects.filter((effect: any) => {
        const expiresAtTurn = Number(effect?.expiresAtTurn);
        return Number.isFinite(expiresAtTurn) && expiresAtTurn > currentTurn;
      });
      endedCount += beforeCount - state.damagePreventionEffects.length;
      if (state.damagePreventionEffects.length === 0) {
        delete state.damagePreventionEffects;
      }
    }
    
    // Clear creatures attacked this turn count (for Minas Tirith, etc.)
    if (state.creaturesAttackedThisTurn) {
      state.creaturesAttackedThisTurn = {};
      debug(2, `${ts()} [endTemporaryEffects] Cleared creaturesAttackedThisTurn tracking`);
    }

    const expiredDealtDamageWatchers = expireDelayedDealtDamageWatchers(state);
    if (expiredDealtDamageWatchers > 0) {
      endedCount += expiredDealtDamageWatchers;
      debug(2, `${ts()} [endTemporaryEffects] Expired ${expiredDealtDamageWatchers} dealt-damage delayed watcher(s)`);
    }
    
    if (endedCount > 0) {
      debug(2, `${ts()} [endTemporaryEffects] Ended ${endedCount} temporary effect(s) (Rule 514.2)`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} endTemporaryEffects failed:`, err);
  }
}

/**
 * Known cards with activated abilities that end the turn.
 * This whitelist is more reliable than pattern matching oracle text.
 * Cards on this list have "{cost}: End the turn" style abilities that can be
 * activated during cleanup step.
 */
const SUNDIAL_EFFECT_CARDS = new Set([
  "sundial of the infinite",
  "obeka, brute chronologist",
  "obeka, splitter of seconds",
]);

/**
 * Check if a permanent has an activated "end the turn" ability.
 * Uses a whitelist of known cards plus pattern matching for edge cases.
 * 
 * Pattern matching rules:
 * - Must have "end the turn" in oracle text
 * - Must have activation cost indicator (colon ':')
 * - Must NOT be a triggered ability ("at the beginning", "when", "whenever")
 * - Must NOT be a spell effect only (needs to be an activated ability on a permanent)
 */
function hasEndTurnActivatedAbility(cardName: string, oracleText: string): boolean {
  const nameLower = cardName.toLowerCase();
  const oracleLower = oracleText.toLowerCase();
  
  // Check whitelist first for known cards
  if (SUNDIAL_EFFECT_CARDS.has(nameLower)) {
    return true;
  }
  
  // Pattern match for other potential cards with activated "end the turn" abilities
  if (!oracleLower.includes("end the turn")) {
    return false;
  }
  
  // Must have activation cost indicator (like ":" or "{T}:")
  if (!oracleLower.includes(":")) {
    return false;
  }
  
  // Exclude triggered abilities (these aren't activated abilities)
  if (oracleLower.includes("at the beginning") || 
      oracleLower.includes("when ") || 
      oracleLower.includes("whenever ")) {
    // Check if "end the turn" appears in the triggered ability part
    // by looking for cost indicator before "end the turn"
    const endTurnIndex = oracleLower.indexOf("end the turn");
    const colonIndex = oracleLower.lastIndexOf(":", endTurnIndex);
    const triggerIndex = Math.max(
      oracleLower.lastIndexOf("at the beginning", endTurnIndex),
      oracleLower.lastIndexOf("when ", endTurnIndex),
      oracleLower.lastIndexOf("whenever ", endTurnIndex)
    );
    
    // If the trigger keyword is after the last colon before "end the turn",
    // this is likely a triggered ability, not activated
    if (triggerIndex > colonIndex) {
      return false;
    }

  }
  
  return true;
}

/**
 * Check if any player has a "Sundial-like" effect available.
 * Sundial of the Infinite and similar cards can end the turn during cleanup,
 * which means players should be given priority during cleanup if they control
 * such an effect.
 * 
 * Rule 514.3: Players normally don't get priority during cleanup step unless
 * state-based actions are performed or abilities trigger. However, if a player
 * has an ability that could affect the game during cleanup (like Sundial),
 * we should give them an opportunity to act.
 * 
 * This function iterates the battlefield once and checks all permanents.
 */
function anyPlayerHasSundialEffect(ctx: GameContext): boolean {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return false;
    
    // Single pass through the battlefield
    for (const permanent of battlefield) {
      if (!permanent || !permanent.card) continue;
      
      const cardName = permanent.card.name || "";
      const oracleText = permanent.card.oracle_text || "";
      
      if (hasEndTurnActivatedAbility(cardName, oracleText)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, `${ts()} [anyPlayerHasSundialEffect] Error checking for Sundial effects:`, err);
    return false;
  }
}

/**
 * Get the maximum hand size for a player.
 * Default is 7, but effects like "no maximum hand size" can change this.
 * 
 * Considers:
 * 1. Permanent effects (Reliquary Tower, Thought Vessel, Spellbook, Venser's Journal)
 * 2. Spell effects that persist (Praetor's Counsel - "for the rest of the game")
 * 3. Player-specific state overrides
 * 4. Emblems with hand size effects
 * 
 * @param ctx Game context
 * @param playerId Player ID
 * @returns Maximum hand size for the player (Infinity for no maximum)
 */
function getMaxHandSize(ctx: GameContext, playerId: string): number {
  try {
    // Check if player has "no maximum hand size" effect
    const state = (ctx as any).state;
    if (!state) return 7;
    
    // Check player-specific overrides (set by spells like Praetor's Counsel)
    // maxHandSize can be: a number, Infinity, or undefined
    const playerMaxHandSize = state.maxHandSize?.[playerId];
    if (playerMaxHandSize === Infinity || playerMaxHandSize === Number.POSITIVE_INFINITY) {
      return Infinity;
    }
    
    // Check for "no maximum hand size" flags set by resolved spells
    // This handles Praetor's Counsel and similar effects
    const noMaxHandSize = state.noMaximumHandSize?.[playerId];
    if (noMaxHandSize === true) {
      return Infinity;
    }
    
    // Check player effects array for hand size modifications
    const playerEffects = state.playerEffects?.[playerId] || [];
    for (const effect of playerEffects) {
      if (effect && (effect.type === 'no_maximum_hand_size' || 
                     effect.effect === 'no_maximum_hand_size')) {
        return Infinity;
      }
    }
    
    // Check for battlefield permanents that grant "no maximum hand size"
    // Examples: Reliquary Tower, Thought Vessel, Spellbook, Venser's Journal
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const oracle = (perm.card?.oracle_text || "").toLowerCase();
        if (oracle.includes("you have no maximum hand size") ||
            oracle.includes("no maximum hand size")) {
          return Infinity;
        }
      }
    }
    
    // Check emblems controlled by the player
    const emblems = state.emblems || [];
    for (const emblem of emblems) {
      if (emblem && emblem.controller === playerId) {
        const effect = (emblem.effect || emblem.text || "").toLowerCase();
        if (effect.includes("no maximum hand size")) {
          return Infinity;
        }
      }
    }
    
    // Check for a numeric override
    if (typeof playerMaxHandSize === "number" && playerMaxHandSize > 0) {
      return playerMaxHandSize;
    }
    
    // Default maximum hand size
    return 7;
  } catch (err) {
    debugWarn(1, `${ts()} getMaxHandSize failed:`, err);
    return 7;
  }
}

/**
 * Setup cleanup step discard for the active player.
 * Rule 514.1: At the beginning of the cleanup step, if the active player's hand
 * contains more cards than their maximum hand size, they discard enough cards
 * to reduce their hand to that number.
 * 
 * This checks if discard is needed and sets up the pending selection state for interactive choice.
 * Returns: { needsInteraction: boolean, discardCount: number }
 */
function setupCleanupDiscard(ctx: GameContext, playerId: string): { needsInteraction: boolean; discardCount: number } {
  try {
    if ((ctx as any).isReplaying) {
      return { needsInteraction: false, discardCount: 0 };
    }

    const state = (ctx as any).state;
    if (!state) return { needsInteraction: false, discardCount: 0 };

    const gameId = (ctx as any).gameId;
    if (!gameId) return { needsInteraction: false, discardCount: 0 };
    
    const maxHandSize = getMaxHandSize(ctx, playerId);
    if (maxHandSize === Infinity) {
      return { needsInteraction: false, discardCount: 0 }; // No maximum hand size
    }
    
    // If a cleanup discard step is already queued, don't create another.
    try {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find(s => s.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.reason === 'cleanup');
      if (existing) {
        return { needsInteraction: true, discardCount: Number((existing as any).discardCount || 0) };
      }
    } catch {
      // Best-effort only
    }
    
    // Get player's hand from state.zones (authoritative source)
    let hand: any[] = [];
    const zones = state.zones || {};
    const playerZones = zones[playerId];
    if (playerZones && Array.isArray(playerZones.hand)) {
      hand = playerZones.hand;
    }
    
    if (hand.length === 0) {
      return { needsInteraction: false, discardCount: 0 };
    }
    
    const handSize = hand.length;
    
    if (handSize <= maxHandSize) {
      return { needsInteraction: false, discardCount: 0 }; // Already at or below max
    }
    
    const discardCount = handSize - maxHandSize;
    
    const handOptions = hand
      .filter((c: any) => c && c.id)
      .map((c: any) => ({
        id: String(c.id),
        label: String(c.name || c.label || 'Unknown'),
        imageUrl: c.imageUrl || c.image_url || c.image_uris?.normal,
      }));

    if (handOptions.length === 0) {
      return { needsInteraction: false, discardCount: 0 };
    }

    // Full zone cards for integrity if this step is ever persisted/replayed.
    // `hand` stays ChoiceOptions for the discard UI (must include every hand card).
    const zoneHandSnapshot = hand
      .filter((c: any) => c && typeof c === 'object' && c.id)
      .map((c: any) => ({ ...c, zone: 'hand' }));

    // Queue cleanup discard selection via Resolution Queue
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      sourceName: 'Cleanup Step',
      description: `Cleanup: discard ${discardCount} card(s) to maximum hand size (${maxHandSize}).`,
      mandatory: true,
      hand: handOptions,
      zoneHandSnapshot,
      discardCount,
      currentHandSize: handOptions.length,
      maxHandSize,
      reason: 'cleanup',
      priority: -10,
    } as any);
    
    debug(2, `${ts()} [setupCleanupDiscard] Queued cleanup discard step for ${playerId}: discard ${discardCount} (hand: ${handSize}, max: ${maxHandSize})`);
    
    return { needsInteraction: true, discardCount };
  } catch (err) {
    debugWarn(1, `${ts()} setupCleanupDiscard failed:`, err);
    return { needsInteraction: false, discardCount: 0 };
  }
}

/**
 * Cleanup-step turn actions from nextStep() when shouldAdvanceTurn is set
 * (Rule 514): discard-to-hand-size, optional Sundial pause, then damage
 * clear + until-end-of-turn expiry. nextStep remains the dispatcher and
 * calls nextTurn() when this returns shouldCallNextTurn.
 */
export function runTurnStepCleanup(ctx: GameContext, isReplaying: boolean): { shouldCallNextTurn: boolean } {
      let skipImplicitNextTurnCall = false;
      if (isReplaying) {
        const nextEventType = String(((ctx as any)._replayNextEventType ?? '')).trim();
        if (nextEventType === 'nextTurn') {
          debug(2, `${ts()} [nextStep] In replay mode - next event is nextTurn; skipping implicit nextTurn call to avoid double-advance`);
          skipImplicitNextTurnCall = true;
        }
      }
      
      // Check if we're proceeding from cleanup (player already had chance to use Sundial)
      const cleanupProceed = (ctx as any)._cleanupProceed === true;
      delete (ctx as any)._cleanupProceed; // Clear the flag
      
      // Check if any player has a Sundial-like effect available
      // Only check this when ENTERING cleanup, not when proceeding from it
      const hasSundialEffect = !cleanupProceed && anyPlayerHasSundialEffect(ctx);
      
      // Check if stack is empty
      const stackEmpty = !Array.isArray((ctx as any).state.stack) || (ctx as any).state.stack.length === 0;
      
      // Rule 514.1: Check if discard is needed before advancing
      try {
        const turnPlayer = (ctx as any).state.turnPlayer;
        if (turnPlayer) {
          const discardCheck = setupCleanupDiscard(ctx, turnPlayer);
          if (discardCheck.needsInteraction && discardCheck.discardCount > 0) {
            // Player needs to choose cards to discard - don't advance turn yet
            debug(2, `${ts()} [nextStep] Waiting for player to select ${discardCheck.discardCount} cards to discard`);
            ctx.bumpSeq();
            return { shouldCallNextTurn: false }; // Stop here - turn will advance after discard selection
          }
        }
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to check discard during cleanup:`, err);
      }
      
      // If any player has a Sundial-like effect and stack is empty, 
      // don't auto-advance - let players have a chance to use it
      // Per Rule 514.3: Normally no priority during cleanup, but if triggers or SBAs occur, priority is given
      // We extend this to also give priority when Sundial effects are available
      if (hasSundialEffect && stackEmpty) {
        debug(2, `${ts()} [nextStep] Player has Sundial effect available, pausing at cleanup for potential action`);
        ctx.bumpSeq();
        return { shouldCallNextTurn: false }; // Stop here - player can use Sundial effect or pass to advance
      }

      // Rule 514.3: if the stack is still occupied (bounce ETB, leftover trigger),
      // stay in cleanup and grant priority instead of advancing the turn.
      // Replay keeps the old auto-advance so recorded nextTurn events stay aligned.
      if (!isReplaying && !stackEmpty) {
        debug(2, `${ts()} [nextStep] Cleanup waiting — stack not empty (Rule 514.3)`);
        ctx.bumpSeq();
        return { shouldCallNextTurn: false };
      }

      if (!isReplaying) {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
            if (pendingSummary.hasPending) {
              debug(2, `${ts()} [nextStep] Cleanup waiting — pending resolution steps: ${pendingSummary.pendingTypes.join(', ')}`);
              ctx.bumpSeq();
              return { shouldCallNextTurn: false };
            }
          }
        } catch (err) {
          debugWarn(1, `${ts()} [nextStep] Failed to check pending resolution steps during cleanup:`, err);
        }
      }
      
      // Rule 514.2: Clear damage from all permanents and end temporary effects
      // This happens simultaneously after discarding
      try {
        clearDamageFromPermanents(ctx);
        endTemporaryEffects(ctx);
      } catch (err) {
        debugWarn(1, `${ts()} [nextStep] Failed to clear damage/effects during cleanup:`, err);
      }
      
      debug(2, `${ts()} [nextStep] Cleanup complete, advancing to next turn`);
      ctx.bumpSeq();
      if (skipImplicitNextTurnCall) {
        return { shouldCallNextTurn: false };
      }
      return { shouldCallNextTurn: true };
}
